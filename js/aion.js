/**
 * Aion2 角色數據分析系統 - 核心邏輯檔案 (aion.js)
 * 
 * 此檔案為整個系統的中樞，負責：
 * 1. 角色數據解析與處理：從 API 獲取的 JSON 數據萃取裝備、統計值、稱號等。
 * 2. UI 動態渲染：負責網頁上所有數據卡片、圖表與列表的 HTML 生成。
 * 3. 戰鬥數據統計：與各類加成（被動、增益效果）進行計算，模擬最終面板數值。
 * 4. 交互控制：處理搜尋、分頁切換、增益效果勾選等使用者事件。
 */

// 初始化：讀取上次搜尋的角色與伺服器
window.onload = function () {
    const savedName = localStorage.getItem('last_char_name');
    if (savedName) document.getElementById('charNameInput').value = savedName;

    // 初始化增益效果控制面板
    if (typeof initGainControls === 'function') {
        initGainControls();
    }

    // 屬性說明資料 (已透過 stat_descriptions.js 載入至 window.STAT_DESCRIPTIONS)
    if (window.STAT_DESCRIPTIONS) {
        // [屬性說明] 已預載
    }
}

// 供外部腳本呼叫的重繪函數 (例如 QuestLog 資料庫載入完成後)
window.renderEquipment = function () {
    if (window.__LAST_DATA_JSON__) {
        // 觸發重新渲染 log 已移除
        // skipScroll=true, skipWingRender=true (僅更新裝備與評分)
        processData(window.__LAST_DATA_JSON__, true, true);
    }
};

// Proxy 函數
function getProxyUrl(url) {
    return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;
}

// wings_data.json 英文 stat key → 中文名稱對應表
const WING_STAT_KEY_MAP = {
    'fpmax': '飛行力',
    'hpmax': '生命力',
    'mpmax': '精神力',
    'defense': '防禦力',
    'accuracy': '命中',
    'critical': '暴擊',
    'criticalresist': '暴擊抵抗',
    'evasion': '迴避',
    'block': '格擋',
    'blockpierce': '格擋貫穿',
    'defensepierce': '貫穿',
    'fixingdamage': '額外攻擊力',
    'bossnpcdefense': '首領防禦力',
    'bossnpcadddamage': '首領攻擊力',
    'bossnpcamplifydamage': '首領傷害增幅',
    'bossnpcdecreasedamage': '首領傷害耐性',
    'amplifyalldamage': '傷害增幅',
    'decreasedamage': '傷害耐性',
    'hpregen': '生命力自然恢復',
    'mpregen': '精神力自然恢復',
    'shockpropertyaccuracy': '衝擊系擊中',
    'shockpropertyresist': '異常狀態抵抗',
    'backattackcriticalresist': '背後暴擊抵抗',
    'pveaccuracy': 'PvE命中',
    'pveadddamage': 'PvE攻擊力',
    'pveamplifydamage': 'PvE傷害增幅',
    'pvedamagedefense': 'PvE防禦力',
    'cooltimedecrease': '冷卻縮短',
    'hppotionrate': '生命力藥水恢復增加',
    'abnormalaccuracy': '異常狀態命中',
    'abnormalresistance': '異常狀態抵抗',
    'criticaladddamage': '暴擊傷害增幅',
};

// wings_data.json 中，這些 key 的值是 × 100 的整數 (例如 2.5% 存為 250)，需要 ÷ 100 轉換
const WING_PERCENT_KEYS = new Set([
    'amplifyalldamage', 'decreasedamage',
    'bossnpcamplifydamage', 'bossnpcdecreasedamage',
    'pveamplifydamage',
    'hppotionrate', 'cooltimedecrease',
    'criticaladddamage',
]);

// 從翅膀資料庫 (wings_data.js) 載入翅膀資料 (以名稱為 key 的 Map)
let WINGS_JSON_MAP = null;
if (window.WINGS_DATA_DB) {
    WINGS_JSON_MAP = {};
    (window.WINGS_DATA_DB.result?.data || []).forEach(w => {
        WINGS_JSON_MAP[w.name] = w;
    });
    // [翅膀資料庫] 已預載資訊已移除
} else {
    console.warn('[翅膀資料庫] 未找到預載資料，將使用靜態資料庫');
}

/**
 * 從 wings_data.json 取得翅膀的裝備加成 (依強化等級)
 * 回傳格式: { '中文屬性名': 數值, ... }
 */
function getWingEquipStatsFromJson(wingName, enchantLevel) {
    if (!WINGS_JSON_MAP) return null;
    // 精確比對
    let wingData = WINGS_JSON_MAP[wingName];
    // 模糊比對 (翅膀名稱可能有些微差異)
    if (!wingData) {
        for (let key in WINGS_JSON_MAP) {
            if (wingName.includes(key) || key.includes(wingName)) {
                wingData = WINGS_JSON_MAP[key];
                break;
            }
        }
    }
    if (!wingData || !wingData.equipStats) return null;

    const equipStats = wingData.equipStats;
    const level = enchantLevel || 0;
    const result = {};

    // 輔助：加入 stat 值，百分比類型需 ÷ 100
    const addStat = (key, rawVal) => {
        const chName = WING_STAT_KEY_MAP[key];
        if (!chName || key === 'fpmax') return; // 飛行力不計入戰鬥屬性
        let val = rawVal;
        if (WING_PERCENT_KEYS.has(key)) val = rawVal / 100; // 轉換為小數 (2.5% 的形式)
        result[chName] = (result[chName] || 0) + val;
    };

    // 1. 加入 mainStats (固定基礎值)
    if (equipStats.mainStats) {
        for (let key in equipStats.mainStats) addStat(key, equipStats.mainStats[key]);
    }

    // 2. 加入對應強化等級的 enchant stats
    if (equipStats.enchants && equipStats.enchants.length > 0) {
        // 找到對應等級的資料 (level 0 = 未強化)
        const enchantData = equipStats.enchants.find(e => e.level === level)
            || equipStats.enchants[Math.min(level, equipStats.enchants.length - 1)];
        if (enchantData && enchantData.stats) {
            for (let key in enchantData.stats) addStat(key, enchantData.stats[key]);
        }
    }

    return Object.keys(result).length > 0 ? result : null;
}

// 翅膀手工維護資料庫 (根據使用者提供資料表)
const WING_DATABASE = {
    '黑暗帳幕翅膀': {
        grade: 'epic',
        equip: { '額外攻擊力': 60, '傷害增幅': 0.025, '首領防禦力': 500, '首領傷害耐性': 0.035 },
        hold: { '飛行力': 200, '傷害增幅': 0.01, '首領防禦力': 300 }
    },
    '燦爛的愛之翅膀': {
        grade: 'epic',
        equip: { '額外防禦力': 400, '額外迴避': 35, '精神力自然恢復': 90, '生命力藥水恢復增加': 0.055 },
        hold: { '飛行力': 200, '額外防禦力': 100, '精神力': 100 }
    },
    '守護者下級翅膀': {
        grade: 'common',
        equip: { '生命力': 200 },
        hold: { '飛行力': 2000, '生命力': 50 }
    },
    '守護者中級翅膀': {
        grade: 'rare',
        equip: { '額外防禦力': 200, '生命力': 300 },
        hold: { '飛行力': 500, '額外攻擊力': 10 }
    },
    '守護者上級翅膀': {
        grade: 'legend',
        equip: { '額外防禦力': 300, '精神力': 200, '生命力': 400 },
        hold: { '飛行力': 500, '額外防禦力': 100 }
    },
    '守護者最上級翅膀': {
        grade: 'unique',
        equip: { '額外防禦力': 400, '生命力': 500, '精神力': 250, '貫穿': 500 },
        hold: { '飛行力': 500, '額外命中': 20, '貫穿': 100 }
    },
    '阿爾拉烏翅膀': {
        grade: 'unique',
        equip: { '額外迴避': 25, '生命力': 300 },
        hold: { '飛行力': 200, '生命力': 50 }
    },
    '征服者翅膀': {
        grade: 'unique',
        equip: { '首領攻擊力': 80, '首領防禦力': 400, '額外防禦力': 300, },
        hold: { '飛行力': 200, '首領攻擊力': 10, }
    },
    '封印翅膀': {
        grade: 'unique',
        equip: { '生命力': 400, '生命力自然恢復': 200, '所受治癒量': 0.05, },
        hold: { '飛行力': 200, '生命力': 50, }
    },
    '光榮翅膀': {
        grade: 'unique',
        equip: { '精神力消耗量減少': 0.03, '精神力': 200, '精神力自然恢復': 80, },
        hold: { '飛行力': 200, '精神力消耗量減少': 0.01, }
    },
    '閃亮的銀河翅膀': {
        grade: 'myth',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_009.Icon_WingA_009.png',
        equip: {},
        hold: {}
    },
    '克羅梅德翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingB_014.Icon_WingB_014.png',
        equip: { '額外防禦力': 200, '暴擊': 35, '生命力': 500, '生命力自然恢復': 250, },
        hold: { '飛行力': 200, '生命力': 50, '生命力自然恢復': 50, }
    },
    '紫花蝴蝶翅膀': {
        grade: 'rare',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingD_009.Icon_WingD_009.png',
        equip: { '額外攻擊力': 40, '額外防禦力': 200, },
        hold: { '飛行力': 200, '生命力': 50 }
    },
    '妖精之夢翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_013.Icon_WingA_013.png',
        equip: { '生命力自然恢復': 0.05, '生命力藥水恢復': 300, },
        hold: { '飛行力': 200, '額外攻擊力': 10, }
    },
    '勇士翅膀': {
        grade: 'legend',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_003A.Icon_WingA_003A.png',
        equip: { '額外防禦力': 300, '精神力': 200, '衝擊系擊中': 0.04, },
        hold: { '飛行力': 200, '衝擊系抵抗': 0.025 }
    },
    '守護者上級翅膀': {
        grade: 'legend',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingB_007C.Icon_WingB_007C.png',
        equip: { '防禦力': 250 }, // Approximation based on DB pattern if needed, but keeping existing structure
        hold: { '飛行力': 200, '防禦力': 100 }
    },
    '奧德翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingB_010.Icon_WingB_010.png',
        equip: { '生命力': 400, '精神力自然恢復': 80, '精神力': 200 },
        hold: { '飛行力': 200, '額外防禦力': 100 }
    },
    '精靈翅膀': {
        grade: 'legend',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingD_002.Icon_WingD_002.png',
        equip: { '額外防禦力': 300, '生命力': 400, '格擋': 50, },
        hold: { '飛行力': 200, '額外防禦力': 100 }
    },
    '古代阿爾拉屋翅膀': {
        grade: 'myth',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingB_004.Icon_WingB_004.png', // Guessing base Alra icon
        equip: { '額外攻擊力': 60, '額外防禦力': 400, '生命力': 500, '生命力自然恢復': 250 },
        hold: { '飛行力': 200, '額外命中': 20, '後方攻擊力': 10 }
    },
    '闇黑破片翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_012.Icon_WingA_012.png',
        equip: { '暴擊': 35, '暴擊攻擊力': 95, '生命力': 500, '生命力自然恢復': 250 },
        hold: { '飛行力': 200, '額外迴避': 20, '格擋': 10 }
    },
    '藍色波濤翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingD_004.Icon_WingD_004.png',
        equip: { '額外迴避': 35, '暴擊抵抗': 35, '精神力': 250, '精神力自然恢復': 90 },
        hold: { '飛行力': 200, '暴擊抵抗': 20, '後方暴擊抵抗': 40 }
    },
    '黑暗帳幕翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_012.Icon_WingA_012.png',
        equip: { '暴擊': 35, '暴擊抵抗': 95, '生命力': 500, '生命力自然恢復': 250 },
        hold: { '飛行力': 200, '額外迴避': 20, '格擋': 10 }
    },
    '森林精靈翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_010.Icon_WingA_010.png',
        equip: { '首領攻擊力': 95, '首領傷害增幅': 0.035, '傷害耐性': 0.025, '額外防禦力': 400 },
        hold: { '飛行力': 200, '傷害耐性': 0.01, '首領攻擊力': 30 },
    },
    '惡夢翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_005.Icon_WingA_005.png',
        equip: { '額外攻擊力': 60, '額外命中': 35, '暴擊': 35, '首領傷害增幅': 0.035 },
        hold: { '飛行力': 200, '首領攻擊力': 30, '首領防禦力': 250 }
    },
    '鬥士翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_003.Icon_WingA_003.png',
        equip: { '額外防禦力': 400, '生命力': 500, '衝擊系擊中': 0.03, '異常狀態擊中': 0.03 },
        hold: { '飛行力': 200, '傷害耐性': 0.01, '衝擊系擊中': 0.025 }
    },
    '藍蝴蝶翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingD_003.Icon_WingD_003.png',
        equip: { '額外防禦力': 400, '生命力藥水恢復': 300, '生命力藥水恢復增加': 0.05, '生命力': 500 },
        hold: { '飛行力': 200, '額外命中': 20, '額外迴避': 20 }
    },
    '春花蝴蝶翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingD_005.Icon_WingD_005.png',
        equip: { '額外攻擊力': 60, '額外命中': 35, '格擋貫穿': 60, '貫穿': 500 },
        hold: { '飛行力': 200, '額外攻擊力': 10, '格擋貫穿': 10 }
    },
    '空虛塔里斯拉翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_011.Icon_WingA_011.png',
        equip: { '額外攻擊力': 60, '額外防禦力': 400, '額外命中': 35, '冷卻時間減少': 0.04 },
        hold: { '飛行力': 200, '額外命中': 20, '額外防禦力': 100 }
    },
    '無我翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingA_008.Icon_WingA_008.png',
        equip: { '貫穿': 500, '強擊': 0.03, '再生': 0.03, '鐵壁': 0.03 },
        hold: { '飛行力': 200, '額外防禦力': 100, '格檔': 10 }
    },
    '德拉瑪塔巢穴翅膀': {
        grade: 'unique',
        icon: 'https://questlog.gg/assets/Game/UI/Resource/Texture/Item/Wing/Icon_WingB_007A.Icon_WingB_007A.png',
        equip: { 'PVE攻擊力': 95, 'PVE防禦力': 500, 'PVE命中': 45, 'PVE傷害增幅': 0.035 },
        hold: { '飛行力': 200, '額外攻擊力': 10, '額外命中': 20 }
    }
};

// 增益效果資料庫
const GAIN_EFFECT_DATABASE = {
    '帳號安全': {
        stats: { '防禦力': 30 },
        default: true
    },
    '角色基礎值': {
        stats: {
            '生命力': 4593,
            '額外攻擊力': 60,
            '額外防禦力': 440
        },
        default: true
    },
    '種族石柱': {
        stats: {
            '生命[尤斯迪埃]': 20,
            '行動力': 620,
            '命運[瑪爾庫坦]': 20,
            '時間[希埃爾]': 40,
            '空間[伊斯拉佩爾]': 40,
            '死亡[崔妮爾]': 20,
            '自由[白傑爾]': 20,
            '正義[奈薩肯]': 20,
            '破壞[吉凱爾]': 20,
            '智慧[露梅爾]': 20,
            '幻象[凱西內爾]': 20
        },
        default: true
    },
    '寵物收藏': {
        stats: {
            '生命力': 2870,
            '知識': 106,
            '威力': 41,
            '暴擊': 205,
            '知性族傷害增幅': 4.1,
            '精神力': 1680,
            '精確': 48,
            '意志': 94,
            '暴擊抵抗': 240,
            '自然族傷害增幅': 4.8,
            '坐騎地面移動速度': 455,
            '敏捷': 65,
            '額外命中': 325,
            '野性族傷害增幅': 6.5,
            '坐騎疾走消耗減少': 32.2,
            '體力': 46,
            '額外迴避': 230,
            '變形族傷害增幅': 4.6
        },
        default: true
    },
    '翅膀收藏': {
        stats: {
            // 暫無具體數值，待補
        },
        default: true
    },
    '深淵石柱': {
        stats: {
            'PVP攻擊力': 20,
            'PVP防禦力': 300,
            'PVP命中': 20,
            'PVP迴避': 40,
            'PVP暴擊': 20,
            'PVP暴擊抵抗': 40
        },
        default: true // 🟢 設為預設開啟
    },

    '被動技能': {
        stats: {},
        default: true
    },
    '排除PVE與首領': {
        stats: {},
        default: false,
        _isFlag: true,
        _desc: '勾選後，戰力指標將排除 PVE攻擊力、首領攻擊力、PVE/首領字樣的加成。'
    },
    '排除守護力': {
        stats: {},
        active: false, // 🛠️ 確保預設不打勾
        default: false,
        _isFlag: true,
        _desc: '勾選後，戰力指標將排除七大守護力板塊的所有屬性加成，顯示純裝備數字。'
    }
};

// PVE 與首領相關的鍵名前缀
const PVE_BOSS_PREFIXES = ['PVE', '首領'];
window.isExcludePveBoss = () => !!(GAIN_EFFECT_DATABASE['排除PVE與首領'] && GAIN_EFFECT_DATABASE['排除PVE與首領'].active);
window.isExcludeBoardStats = () => !!(GAIN_EFFECT_DATABASE['排除守護力'] && GAIN_EFFECT_DATABASE['排除守護力'].active);

// Helper function to fetch all titles with pagination
async function fetchAllTitles(serverId, characterId, initialTitleList, ownedCount) {
    let allTitles = [...initialTitleList]; // Start with the titles already fetched
    let currentPage = 1; // Assuming initialTitleList is from page 1

    // If ownedCount is not available or initial list is already complete, no need to paginate
    if (!ownedCount || allTitles.length >= ownedCount) {
        return allTitles;
    }

    // Loop until all titles are fetched or an error occurs
    while (allTitles.length < ownedCount) {
        currentPage++;
        const titlesUrl = `https://aion-api.bnshive.com/v1/characters/${serverId}/${encodeURIComponent(characterId)}/titles?page=${currentPage}`;
        const titlesProxyUrl = getProxyUrl(titlesUrl);

        // console.log(`Fetching titles page ${currentPage} from:`, titlesProxyUrl);

        try {
            const response = await fetch(titlesProxyUrl);
            if (!response.ok) {
                // console.error(`Failed to fetch titles page ${currentPage}: ${response.status}`);
                break; // Stop if a page fails
            }
            const json = await response.json();

            // Assuming the API returns a structure like { result: "Success", data: { titleList: [...] } }
            const newTitles = json.data && json.data.titleList ? json.data.titleList : [];

            if (newTitles.length === 0) {
                // No more titles to fetch, or an issue with the API response
                // console.log(`No new titles found on page ${currentPage}. Stopping pagination.`);
                break;
            }

            allTitles = allTitles.concat(newTitles);
            // console.log(`Fetched ${newTitles.length} titles on page ${currentPage}. Total titles: ${allTitles.length}/${ownedCount}`);

        } catch (error) {
            // console.error(`Error fetching titles page ${currentPage}:`, error);
            break; // Stop on error
        }
    }
    return allTitles;
}

// --- 核心 API 請求邏輯 ---

// Helper: 直接載入角色數據 (已知 ID 時使用)
async function loadCharacterData(serverId, characterId, charName = '') {
    // 隱藏搜尋結果
    const resultsContainer = document.getElementById('search-results');
    if (resultsContainer) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = ''; // 清空結果
    }

    // 將已選擇的名字填入輸入框並保存
    if (charName) {
        document.getElementById('charNameInput').value = charName;
        localStorage.setItem('last_char_name', charName);
    }

    // 開始分析時，在背景啟動 QuestLog 裝備資料庫同步，增強評分準確度
    // 這個動作只有在真正選擇玩家並載入資料時才進行，不會在網頁剛打開就亂按 API
    if (typeof fetchItemDetailsFromQuestLog === 'function') {
        fetchItemDetailsFromQuestLog();
    }

    document.getElementById('loading').style.display = 'flex';
    document.getElementById('main-content').style.display = 'none';

    try {
        // [DirectLoad] 已移除 log

        // === 步驟 2: 使用 refresh=true 觸發更新並獲取最新資料 ===
        const refreshUrl = `https://aion-api.bnshive.com/character/query?serverId=${serverId}&characterId=${encodeURIComponent(characterId)}&refresh=true`;
        const refreshProxyUrl = getProxyUrl(refreshUrl);

        const refreshResponse = await fetch(refreshProxyUrl);

        let finalJson = null;

        if (refreshResponse.ok) {
            finalJson = await refreshResponse.json();
            if (!finalJson || finalJson.result === "Fail") {
                throw new Error(finalJson.message || "讀取角色詳細資料失敗");
            }
        } else {
            throw new Error("連線至角色資料 API 失敗");
        }

        // === 步驟 3: 記錄訪問 ===
        try {
            const visitUrl = `https://aion-api.bnshive.com/character/${serverId}/${encodeURIComponent(characterId)}/visit`;
            getProxyUrl(visitUrl); // Just get URL, fire and forget via fetch
            fetch(getProxyUrl(visitUrl), { method: 'POST' }).catch(() => { });
        } catch (e) { }

        // 顯示資料
        document.getElementById('main-content').style.display = 'block';
        processData(finalJson);

        // 更新輸入框顯示 (若有)
        if (charName) document.getElementById('charNameInput').value = charName;

    } catch (err) {
        alert("讀取詳細資料失敗:\n" + err.message);
        document.getElementById('search-results').style.display = 'grid'; // 恢復顯示搜尋結果
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}


// 新增：搜尋角色 (List Mode)
// Debounce timer
let searchDebounceTimer = null;

async function searchCharacters(keyword) {
    const mainContent = document.getElementById('main-content');
    const resultsContainer = document.getElementById('search-results');
    const skillContent = document.getElementById('nav-target-skill') ? document.getElementById('nav-target-skill').parentElement : null;
    const collectionContent = document.getElementById('nav-target-collection');

    if (!keyword) {
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
        }
        // 如果先前已經有過載入成功的數據，則恢復顯示看板與下方區塊
        if (window.__LAST_DATA_JSON__) {
            if (mainContent) mainContent.style.display = 'block';
            if (collectionContent) collectionContent.style.display = 'block';
        }
        return;
    }

    // --- 🔍 搜尋行為立即反應：隱藏看板、下方區塊與舊結果 ---
    if (mainContent) mainContent.style.display = 'none';
    if (collectionContent) collectionContent.style.display = 'none';
    if (resultsContainer) resultsContainer.innerHTML = '';

    // Clear previous timer
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

    // Set new timer
    searchDebounceTimer = setTimeout(async () => {
        await executeSearch(keyword);
    }, 500); // 500ms debounce
}

async function executeSearch(keyword) {

    document.getElementById('loading').style.display = 'flex';
    document.getElementById('main-content').style.display = 'none';

    const collectionContent = document.getElementById('nav-target-collection');
    if (collectionContent) collectionContent.style.display = 'none';

    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'none';

    // 清空舊的裝分抓取佇列 (避免使用者快速修改關鍵字導致無效請求堆積)
    if (typeof clearScoreQueue === 'function') {
        clearScoreQueue();
    }

    try {
        const searchUrl = `https://aion-api.bnshive.com/character/search?keyword=${encodeURIComponent(keyword)}&page=1&size=30`;
        const proxyUrl = getProxyUrl(searchUrl);

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("搜尋失敗");

        const json = await res.json();

        const list = json.results || [];

        if (list.length === 0) {
            resultsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#888;">
                找不到符合 "<b>${keyword}</b>" 的角色
            </div>`;
            resultsContainer.style.display = 'grid';
            return;
        }

        // Render List with Header
        let html = `<div style="grid-column: 1/-1; margin-bottom: 20px; color: #8b949e; font-size: 14px;">
            <i class="fas fa-search"></i> 找到 <b>${json.total || list.length}</b> 筆結果
        </div>`;

        list.forEach(char => {
            // Mapping class names to English keys for CSS border colors
            const classMap = {
                '劍星': 'gladiator', '守護星': 'templar', '殺星': 'assassin', '弓星': 'ranger',
                '魔道星': 'sorcerer', '精靈星': 'spirit_master', '治癒星': 'cleric', '護法星': 'chanter',
                '槍擊星': 'gunner', '吟遊星': 'bard', '機甲星': 'rider', '彩繪星': 'painter', '雷擊星': 'thunderer'
            };
            const className = char.className || '未知';
            const classKey = classMap[className] || 'common';

            let imgUrl = char.profileImageUrl || 'https://cms-static.plaync.com/img/common/avatar_default.png';
            if (imgUrl.startsWith('/')) {
                imgUrl = 'https://profileimg.plaync.com' + imgUrl;
            }

            // Race Detection
            let raceName = char.raceName;
            if (!raceName && char.raceId) {
                raceName = (char.raceId === 1) ? '天族' : ((char.raceId === 2) ? '魔族' : '未知');
            }
            const raceColor = (char.raceId === 2 || raceName === '魔族') ? '#ff4757' : '#00d4ff';

            const scoreContainerId = `score-box-${char.characterId}`;

            html += `
            <div id="search-card-${char.characterId}" class="search-card" data-class="${classKey}" data-character-id="${char.characterId}" data-server-id="${char.serverId}" onclick="loadCharacterData(${char.serverId}, '${char.characterId}', '${char.characterName}')">
                
                <div style="display: flex; align-items: center; gap: 20px; width: 100%; margin-left: 2px;">
                    <!-- 頭像區 (88px) 加大 -->
                    <div style="width: 88px; height: 88px; border-radius: 50%; overflow: hidden; background: #000; border: 2px solid rgba(255,255,255,0.1); flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                        <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://cms-static.plaync.com/img/common/avatar_default.png'">
                    </div>
                    
                    <!-- 資訊區 (合併顯示以強制水平對齊) -->
                    <div style="display: flex; flex-direction: column; flex: 1; justify-content: center; padding-right: 4px;">
                        
                        <!-- 上排：名字 (左) & 等級職業 (右) -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; width: 100%; gap: 5px;">
                            <div style="color: var(--card-score-color, #ffffff); font-size: 22px; font-weight: bold; letter-spacing: 0.5px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); transition: color 0.3s; line-height: 1.2;">
                                ${char.characterName}
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-top: 2px;">
                                <span style="color: #adb5bd; font-size: 15px; font-weight: bold;">Lv.${char.characterLevel}</span>
                                <span style="background: rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: bold; color: #e9ecef;">${className}</span>
                            </div>
                        </div>
                        
                        <!-- 下排：種族伺服器 (左) & 分數 (右) -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: 5px;">
                            <div style="font-size: 15px; display: flex; align-items: center; gap: 8px; color: #8b949e; padding-bottom: 2px;">
                                <span style="color:${raceColor}; font-weight: bold;">${raceName || '未知'}</span>
                                <span style="color:rgba(255,255,255,0.15);">|</span>
                                <span>${char.serverName}</span>
                            </div>
                            
                            <div id="${scoreContainerId}" class="peek-score-result" style="display:block; text-align:right; flex-shrink: 0;">
                               <span style="font-size:12px; color:#666;"><i class="fas fa-circle-notch fa-spin"></i> 計算中</span>
                            </div>
                        </div>
                        
                    </div>
                </div>
            </div>
            `;
        });

        resultsContainer.innerHTML = html;
        resultsContainer.style.display = 'grid';

        // 🚀 自動觸發分數獲取 (使用 IntersectionObserver 延遲載入，畫面進入視野才打 API)
        if (typeof queueScoreFetch === 'function') {
            const observerOptions = {
                root: null,
                rootMargin: '50px 0px', // 稍微微提早 50px 載入
                threshold: 0.1
            };

            const scoreObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const target = entry.target;
                        const charId = target.getAttribute('data-character-id');
                        const serverId = target.getAttribute('data-server-id');

                        if (charId && serverId) {
                            queueScoreFetch(serverId, charId, `score-box-${charId}`);
                        }

                        // 載入過後就解除觀察，避免重複排隊或重複觸發
                        observer.unobserve(target);
                    }
                });
            }, observerOptions);

            // 註冊所有已經渲染出的 search-card，交給 Observer 監控
            const searchCards = resultsContainer.querySelectorAll('.search-card');
            searchCards.forEach(card => {
                scoreObserver.observe(card);
            });
        }

    } catch (e) {
        console.error("搜尋發生錯誤: " + e.message);
        resultsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:20px; color:#f00;">搜尋發生錯誤，請稍後再試</div>`;
        resultsContainer.style.display = 'grid';
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

async function fetchFromApi() {
    let charName = document.getElementById('charNameInput').value.trim();

    if (!charName) {
        document.getElementById('search-results').style.display = 'none';
        return;
    }

    // Always use search mode
    searchCharacters(charName);

    // 儲存設定
    localStorage.setItem('last_char_name', charName);
}



// 🧬 被動技能數據庫 (從 JSON 載入，用於定義應追蹤的技能與屬性名稱)
window.PASSIVE_SKILL_DATABASE = {};

// 載入被動技能資料庫 (已透過 passive_skills.js 預載至 window.PASSIVE_SKILLS_DB)
if (window.PASSIVE_SKILLS_DB) {
    const data = window.PASSIVE_SKILLS_DB;
    // 保存原始 JSON 結構以供職業篩選
    window.__RAW_PASSIVE_JSON__ = data;
    // 將分層結構 (職業 -> 技能) 攤平，以利快速查找
    for (const className in data) {
        const skills = data[className];
        for (const skillName in skills) {
            window.PASSIVE_SKILL_DATABASE[skillName] = skills[skillName];
        }
    }
    // 被動技能庫預載 log 已移除

    if (window.__LAST_DATA_JSON__) {
        debouncedPassiveUpdate(window.__LAST_DATA_JSON__);
    }
} else {
    console.warn('⚠️ 未找到預載被動技能分類 passive_skills.js，可能受限');
}


// 🟢 被動技能快取與更新機制 (V11: JSON 導向 + API 實時數值 + 異步防手震)
window.PASSIVE_REAL_CACHE = {};
window._PASSIVE_FETCHING_SET_ = new Set(); // 追蹤正在抓取中的技能
window._PASSIVE_UPDATE_TIMER_ = null;

const loadPassiveCache = () => {
    try {
        const data = localStorage.getItem('PASSIVE_REAL_CACHE_V11');
        if (data) window.PASSIVE_REAL_CACHE = JSON.parse(data);
    } catch (e) {
        window.PASSIVE_REAL_CACHE = {};
    }
};

const savePassiveCache = () => {
    try {
        localStorage.setItem('PASSIVE_REAL_CACHE_V11', JSON.stringify(window.PASSIVE_REAL_CACHE));
    } catch (e) { }
};

// 嘗試載入快取
loadPassiveCache();

// 🆕 防手震更新函數：確保所有 API 回傳後才統整渲染一次
const debouncedPassiveUpdate = (data) => {
    if (window._PASSIVE_UPDATE_TIMER_) clearTimeout(window._PASSIVE_UPDATE_TIMER_);
    window._PASSIVE_UPDATE_TIMER_ = setTimeout(() => {
        updatePassiveSkills(data);
        if (typeof initGainControls === 'function') initGainControls();

        // 🚀 關鍵修復：被動技能數據更新後，必須重新觸發統計計算與 UI 渲染
        // 使用 statsOnly=true 模式，僅更新數值與表格，不重複解析技能，避免無限循環
        if (window.__LAST_DATA_JSON__) {
            // 🔄 被動技能數據更新 log 已移除
            processData(window.__LAST_DATA_JSON__, true, true, true);
        }

        window._PASSIVE_UPDATE_TIMER_ = null;
    }, 300); // 略微增加延遲以確保非同步資料完整
};

function updatePassiveSkills(data) {
    // 🧹 重置被動技能統計，防止數據重複累加
    if (GAIN_EFFECT_DATABASE['被動技能']) {
        GAIN_EFFECT_DATABASE['被動技能'].stats = {};
        GAIN_EFFECT_DATABASE['被動技能'].breakdowns = {};
    }

    let passiveHtml = '';
    let hasPassive = false;

    // 🆕 輔助解析：強化別名捕獲與百分比分流
    const extractDefinedStats = (text, definedStats) => {
        const results = {};
        if (!text || !definedStats) return results;

        const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        // 💡 別名映射：解決「文字不對齊」導致抓不到細項的問題
        const aliasMap = {
            '生命力增加': ['最大生命力額外增加', '最大生命力增加', '生命力額外增加', '生命力增加'],
            '攻擊力增加': ['最大攻擊力額外增加', '攻擊力額外增加', '攻擊力增加', '基本攻擊力'],
            '防禦力增加': ['最大防禦力額外增加', '防禦力額外增加', '防禦力增加', '物理防禦力'],
            '迴避': ['迴避額外增加', '迴避增加', '迴避'],
            '命中': ['命中額外增加', '命中增加', '命中'],
            '暴擊': ['物理致命一擊', '魔法致命一擊', '致命一擊增加', '暴擊增加', '暴擊'],
            '傷害增幅': ['所有傷害增幅', '傷害增幅量', '傷害增幅', '追加傷害'],
            '後方傷害增幅': ['背後傷害增幅', '後方傷害增加量', '後方傷害增幅', '後方攻擊時追加傷害'],
            '暴擊傷害增幅': ['致命一擊傷害增幅', '暴擊傷害增加量', '暴擊傷害增幅']
        };

        Object.keys(definedStats).forEach(statName => {
            const searchNames = aliasMap[statName] || [statName];
            // 判定該屬性在 JSON 中是否定義為百分比 (通常 < 1)
            const isPercInJson = Math.abs(definedStats[statName]) < 1 && definedStats[statName] !== 0;

            for (const nameToSearch of searchNames) {
                const escapedName = nameToSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flexiblePattern = escapedName.split('').join('[^0-9\\+\\-\\%]{0,20}');
                const regex = new RegExp(`${flexiblePattern}[^0-9\\+\\-]*([\\+\\-]?\\d+(?:\\.\\d+)?)(%?)`, "gi");

                const matches = Array.from(cleanText.matchAll(regex));
                if (matches.length > 0) {
                    // 🎯 優先尋找與 JSON 類型相符的數值 (百分比 vs 固定值)
                    let bestMatch = null;
                    if (isPercInJson) {
                        bestMatch = matches.find(m => m[2] === '%') || matches.find(m => parseFloat(m[1]) < 2);
                    } else {
                        bestMatch = matches.find(m => m[2] !== '%' && parseFloat(m[1]) >= 1) || matches[0];
                    }

                    if (bestMatch) {
                        let val = parseFloat(bestMatch[1]);
                        if (bestMatch[2] === '%') val = val / 100;
                        results[statName] = val;
                        return; // 找到即跳過此屬性的其他別名
                    }
                }
            }

            // 🚨 僅當 API 真的匹配不到時，回退 JSON 值
            if (results[statName] === undefined) {
                results[statName] = definedStats[statName];
            }
        });
        return results;
    };





    function preservePercKey(name) {
        const list = ['攻擊力增加', '生命力增加', '防禦力增加', '命中增加', '迴避增加', '暴擊增加', '格擋增加', '暴擊抵抗增加'];
        return list.some(k => name.includes(k)) || name.includes('%');
    }




    // 輔助處理單個技能的數值更新
    const processStats = (skillName, statsObj, isReal) => {
        for (let sName in statsObj) {
            let val = statsObj[sName];

            // 💡 歸類決策：包含特定關鍵字即為百分比項
            // 🚨 修正：不再因「增加」字樣就強制視為百分比，改由 normalizeKey 與 原始數值大小決定
            const isPerc = sName.includes('%');

            // 🚨 [修正] 針對特定屬性 (如 生命力增加)，若數值極小 (<=5)，強制視為百分比
            // 用戶回報 0.24 應顯示 24%
            let forcePerc = isPerc ? true : null;
            const potentialPercStats = [
                '生命力增加', '攻擊力增加', '防禦力增加', '精神力增加',
                '命中增加', '迴避增加', '暴擊增加', '格擋增加', '暴擊抵抗增加',
                '衝擊系擊中增加', '精神系擊中增加', '肉體系擊中增加',
                '衝擊系抵抗增加', '精神系抵抗增加', '肉體系抵抗增加',
                '異常狀態抵抗', '常狀態抵抗'
            ];
            const cleanSName = sName.replace('%', '').trim();
            // 只要名稱包含上述關鍵字 且 數值小於等於 5 (且不為0)，就強制轉為百分比
            if (potentialPercStats.some(k => cleanSName.includes(k)) && Math.abs(val) <= 5 && Math.abs(val) > 0) {
                forcePerc = true;
            }

            // 修正：守護力對應 PVP防禦力
            if (sName.includes('守護力')) {
                const pvpDefKey = 'PVP防禦力';
                if (!GAIN_EFFECT_DATABASE['被動技能'].stats[pvpDefKey]) {
                    GAIN_EFFECT_DATABASE['被動技能'].stats[pvpDefKey] = 0;
                    if (!GAIN_EFFECT_DATABASE['被動技能'].breakdowns[pvpDefKey]) GAIN_EFFECT_DATABASE['被動技能'].breakdowns[pvpDefKey] = [];
                }
                GAIN_EFFECT_DATABASE['被動技能'].stats[pvpDefKey] += val;
                GAIN_EFFECT_DATABASE['被動技能'].breakdowns[pvpDefKey].push(`[${skillName}]: +${val}`);
                continue;
            }

            // 修正：如果不是顯式百分比關鍵字，傳入 null 讓 normalizeKey 根據 alwaysPercent 自動判斷 (例如 鐵壁 -> 鐵壁%)
            const key = normalizeKey(sName, forcePerc);

            if (!GAIN_EFFECT_DATABASE['被動技能'].stats[key]) {
                GAIN_EFFECT_DATABASE['被動技能'].stats[key] = 0;
                if (!GAIN_EFFECT_DATABASE['被動技能'].breakdowns[key]) GAIN_EFFECT_DATABASE['被動技能'].breakdowns[key] = [];
            }

            // 🛡️ 安全門：如果這是一個欄位名稱帶有百分比的，但數值大於 1，這通常是解析錯誤（如抓到 3400）
            if (key.includes('%') && Math.abs(val) >= 1) {
                // 如果數值在 1~100 之間 (如 39)，補償性地將其除以 100 存入
                if (Math.abs(val) < 100) {
                    val = val / 100;
                    // 同步更新原始 statsObj 為後續顯示使用
                    statsObj[sName] = val;
                } else {
                    // 數值太大 (3400)，直接丟棄，防止顯示 340,000%
                    continue;
                }
            }

            GAIN_EFFECT_DATABASE['被動技能'].stats[key] += val;

            let displayVal = key.includes('%') ? (val * 100) : val;
            let unit = key.includes('%') ? '%' : '';
            const displayNum = Number(parseFloat(displayVal).toFixed(2));
            const sourceMark = isReal ? '' : '<span style="color:#666;font-size:10px;"> (分析中...)</span>';

            GAIN_EFFECT_DATABASE['被動技能'].breakdowns[key].push(`[${skillName}]: +${displayNum}${unit}${sourceMark}`);

        }
    };


    // 1. 取得所有技能清單，並預處理名稱（去除羅馬數字與空白）
    const cleanSkillName = (name) => name.replace(/\s+[IVXLCDM\d]+$/g, '').trim();

    const targetSkills = Object.values(data.skill ? data.skill.skillList : (data.skills ? (Array.isArray(data.skills) ? data.skills : data.skills.skillList) : []))
        .map(s => ({ ...s, baseName: cleanSkillName(s.name) }))
        .filter(s => window.PASSIVE_SKILL_DATABASE && window.PASSIVE_SKILL_DATABASE[s.baseName])
        .reduce((acc, curr) => {
            // 同名技能取等級最高者
            if (!acc[curr.baseName] || (curr.level || 1) > (acc[curr.baseName].level || 1)) {
                acc[curr.baseName] = curr;
            }
            return acc;
        }, {});

    // 3 + 4. 【優化】合併兩輪 API 呼叫為一輪：同時處理數值統計與 UI 渲染
    // 原本第一輪(數值)與第二輪(UI)各自打一次 API，現在共用同一次結果
    if (Object.keys(targetSkills).length > 0) {
        window.__PASSIVE_STATS_READY__ = true;

        // 先用快取同步處理已有資料的技能數值
        Object.values(targetSkills).forEach(skill => {
            const skillId = skill.skillId || skill.id;
            const level = skill.level || skill.skillLevel || 1;
            const cacheKey = `${skillId}_${level}`;
            const cachedStats = window.PASSIVE_REAL_CACHE && window.PASSIVE_REAL_CACHE[cacheKey];
            if (cachedStats) {
                processStats(skill.name, cachedStats, true);
            }
        });

        // 一輪 API：同時取得數值與 UI 資料
        Promise.all(Object.values(targetSkills).map(skill => {
            const definedStats = window.PASSIVE_SKILL_DATABASE[skill.baseName];
            const skillId = skill.skillId || skill.id;
            const level = skill.level || skill.skillLevel || 1;
            return window.SkillAPI.fetchSkill(skillId, level).then(info => ({ skill, info, definedStats }));
        })).then(results => {
            let needCacheUpdate = false;

            // 先批次更新數值快取（只處理快取未命中的技能）
            results.forEach(({ skill, info, definedStats }) => {
                if (!info) return;
                const skillId = skill.skillId || skill.id;
                const level = skill.level || skill.skillLevel || 1;
                const cacheKey = `${skillId}_${level}`;
                if (!window.PASSIVE_REAL_CACHE[cacheKey]) {
                    const fullText = (info.description || '') + " " + (info.effects ? info.effects.join(" ") : "");
                    const parsed = extractDefinedStats(fullText, definedStats);
                    if (Object.keys(parsed).length > 0) {
                        window.PASSIVE_REAL_CACHE[cacheKey] = parsed;
                        needCacheUpdate = true;
                    }
                }
            });

            // 統一儲存快取並觸發一次 UI 重整（加旗標防止再入）
            if (needCacheUpdate && !window._IS_PASSIVE_UPDATING_) {
                savePassiveCache();
                window._IS_PASSIVE_UPDATING_ = true;
                debouncedPassiveUpdate(data);
                setTimeout(() => { window._IS_PASSIVE_UPDATING_ = false; }, 1000);
            }
            let detailHtml = '';
            results.forEach(({ skill, info }) => {
                if (!info) return;
                const skillNameForDisplay = skill.baseName;
                const level = skill.level || skill.skillLevel || 1;
                const lvColor = '#ffd93d';

                let iconUrl = info.icon ? info.icon : (skill.icon ? skill.icon : '');
                if (iconUrl && !iconUrl.startsWith('http')) {
                    let parts = iconUrl.split('/');
                    let filename = parts[parts.length - 1];
                    if (filename.includes('.')) filename = filename.split('.')[0];
                    iconUrl = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/' + filename + '.png';
                }
                detailHtml += `
                    <div style="background: rgba(10, 10, 15, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.03); border-left: 3px solid rgba(255,255,255,0.2); backdrop-filter: blur(4px); box-shadow: 0 2px 10px rgba(0,0,0,0.2);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.85); font-weight: bold; font-size: 14px; display:flex; align-items:center; gap:8px;">
                                ${iconUrl ? `<img src="${iconUrl}" style="width:24px; height:24px; border-radius:4px; border: 1px solid rgba(255,255,255,0.1);">` : ''}
                                <span>${skillNameForDisplay}</span>
                            </div>
                            <span style="color:${lvColor}; font-weight:bold; font-size:12px;">Lv.${level}</span>
                        </div>
                        <div style="font-size:13px; line-height:1.6; color:rgba(255, 255, 255, 0.75);">
                            ${window.SkillAPI.formatEffects(info)}
                        </div>
                    </div>
                `;
            });
            window.__PASSIVE_SKILLS_HTML__ = detailHtml || '<div style="padding:20px; text-align:center; color:#8b949e;">未偵測到被動技能加成</div>';

            // 若 DOM 已經生成，則即時更新 UI
            const container = document.getElementById('stat-tab-passive');
            if (container) {
                const grid = container.querySelector('.stat-general-grid');
                if (grid) grid.innerHTML = window.__PASSIVE_SKILLS_HTML__;
            }
        }).catch(e => {
            console.error('Failed to generate passive skill detail HTML', e);
        });
    } else {
        window.__PASSIVE_SKILLS_HTML__ = '<div style="padding:20px; text-align:center; color:#8b949e;">未偵測到被動技能加成</div>';
        window.__PASSIVE_STATS_READY__ = false;
    }
}


// Helper to get wing grade color (Corrected for Aion Standards)
function getWingGradeColor(grade) {
    if (!grade) return '#ffffff';

    // 優先處理數字 grade (QuestLog API: 51/41/31/21/11)
    const gradeNum = parseInt(grade);
    if (!isNaN(gradeNum) && gradeNum >= 11) {
        if (gradeNum >= 51) return '#e67e22';
        if (gradeNum >= 41) return '#f1c40f';
        if (gradeNum >= 31) return '#3498db';
        if (gradeNum >= 21) return '#2ecc71';
        return '#ffffff';
    }

    const g = String(grade).toLowerCase();
    switch (g) {
        case 'myth': case '神話': case 'ancient': case '古代': return '#e67e22';
        case 'unique': case '唯一': case '獨特': return '#f1c40f';
        case 'special': return '#00ffcc';
        case 'legend': case '傳說': case '傳承': case 'epic': case '史詩': return '#3498db';
        case 'heroic': return '#3498db';
        case 'rare': case '稀有': return '#2ecc71';
        case 'common': case '一般': case 'normal': case '普通': return '#ffffff';
        default: return '#ffffff';
    }
}

// --- 增益效果控制邏輯 ---
function initGainControls() {
    const container = document.getElementById('ge-checkbox-container');
    if (!container) return;

    // 💾 加強：從 localStorage 讀取該增益的勾選狀態
    const savedStates = JSON.parse(localStorage.getItem('gainEffectStates_v1') || '{}');

    Object.keys(GAIN_EFFECT_DATABASE).forEach(key => {
        if (savedStates[key] !== undefined) {
            GAIN_EFFECT_DATABASE[key].active = savedStates[key];
        } else if (GAIN_EFFECT_DATABASE[key].active === undefined) {
            GAIN_EFFECT_DATABASE[key].active = GAIN_EFFECT_DATABASE[key].default;
        }

        // Initialize selectedWings array for Wing Collection
        if (key === '翅膀收藏') {
            // Load from localStorage if available
            let saved = JSON.parse(localStorage.getItem('ownedWings') || '[]');

            // Filter out wings that no longer exist in WING_DATABASE (Self-healing)
            const validWings = saved.filter(wName => WING_DATABASE[wName]);
            if (validWings.length !== saved.length) {
                saved = validWings;
                localStorage.setItem('ownedWings', JSON.stringify(saved));
            }
            GAIN_EFFECT_DATABASE[key].selectedWings = saved;

            // 💡 優化：只有在「完全沒有儲存過狀態」且「有翅膀」時才自動啟用
            if (savedStates[key] === undefined && saved.length > 0) {
                GAIN_EFFECT_DATABASE[key].active = true;
            }

            // Pre-calculate stats for tooltip display
            let totalStats = {};
            saved.forEach(wName => {
                const w = WING_DATABASE[wName];
                if (w) {
                    if (w.hold) {
                        for (let s in w.hold) {
                            if (!totalStats[s]) totalStats[s] = 0;
                            totalStats[s] += w.hold[s];
                        }
                    }
                    if (w.equip) {
                        for (let s in w.equip) {
                            if (!totalStats[s]) totalStats[s] = 0;
                            totalStats[s] += w.equip[s];
                        }
                    }
                }
            });
            GAIN_EFFECT_DATABASE[key].stats = totalStats;
        }
    });

    container.innerHTML = Object.keys(GAIN_EFFECT_DATABASE).map(key => {
        const item = GAIN_EFFECT_DATABASE[key];
        const checked = item.active ? 'checked' : '';
        const isWingCollection = key === '翅膀收藏';
        const isFlag = !!item._isFlag;

        // Build stats detail string
        let statsInfo = "";
        let hasStats = false;

        // 旗標型項目：顯示說明文字 + 啟用時顯示排除明細
        if (isFlag) {
            statsInfo = `<div style="color:#8b949e; margin-bottom:6px;">${item._desc || '開啟後影響計算行為'}</div>`;
            if (item.active && item._excludedStats && Object.keys(item._excludedStats).length > 0) {
                statsInfo += `<div style="color:#ff7675; font-weight:bold; margin:12px 0 8px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:8px;">🚫 已排除項目：</div>`;
                statsInfo += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 4px; width: 100%;">`;
                for (const label in item._excludedStats) {
                    const val = item._excludedStats[label];
                    if (Math.abs(val) > 0.001) {
                        statsInfo += `<div style="padding:3px 5px; background:rgba(255,118,117,0.05); border-radius:4px; border:1px solid rgba(255,118,117,0.1); display:flex; flex-direction:column; min-width:0;">
                            <div style="color:#8b949e; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${label}">${label}</div>
                            <div style="color:#ff7675; font-weight:bold; text-align:right; font-size:11px; margin-top:1px;">-${Math.round(val * 100) / 100}</div>
                        </div>`;
                    }
                }
                statsInfo += `</div>`;
            } else if (item.active) {
                statsInfo += `<div style="color:#8b949e; font-size:11px;">（搜尋角色後顯示明細）</div>`;
            }
        } else {
            // 優先顯示 breakdown 細項 (如被動技能)
            if (item.breakdowns && Object.keys(item.breakdowns).length > 0) {
                for (let s in item.breakdowns) {
                    // s 是屬性名稱 (如 暴擊傷害增幅)
                    let total = item.stats ? (item.stats[s] || 0) : 0;
                    // 💡 強化判斷：精確區分百分比與固定值顯示
                    let displayTotal = total;
                    let unit = s.includes('%') ? '%' : '';

                    // 如果 Key 明確不是百分比類別（例如只是「暴擊抵抗」而非「暴擊抵抗%」）
                    // 則強制不顯示百分比，也不進行 100 倍轉換
                    const isFlatStat = !s.includes('%') && (s === "暴擊抵抗" || s === "物理防禦" || s === "生命力" || s === "守護力" || s === "敏捷");

                    if (!isFlatStat && (unit === '%' || !unit) && Math.abs(total) < 1 && Math.abs(total) > 0) {
                        displayTotal = Number((total * 100).toFixed(2));
                        unit = '%';
                    } else if (isFlatStat) {
                        displayTotal = Math.round(total);
                        unit = '';
                    } else {
                        displayTotal = Math.round(total * 1000) / 1000;
                    }

                    statsInfo += `<div style="margin-bottom:2px; margin-top:4px; border-bottom:1px dashed #444; padding-bottom:2px;">
                            <span style="color:#ffd93d;">${s.replace('%', '')}</span> 
                            <span style="color:#fff; font-weight:bold;">+${displayTotal}${unit}</span>
                         </div>`;

                    item.breakdowns[s].forEach(desc => {
                        statsInfo += `<div style="padding-left:8px; font-size:11px; color:#cbd5e1;">${desc}</div>`;
                    });
                    hasStats = true;
                }
            } else if (item.stats) {
                for (let s in item.stats) {
                    let val = item.stats[s];
                    let unit = s.includes('%') ? '%' : '';
                    let dVal = val;
                    if (!unit && Math.abs(val) < 1 && Math.abs(val) > 0) {
                        dVal = Number((val * 100).toFixed(2));
                        unit = '%';
                    } else {
                        dVal = Math.round(val * 1000) / 1000;
                    }
                    statsInfo += `<div style="margin-bottom:2px;">${s}: <span style="color:#fff;">+${dVal}${unit}</span></div>`;
                    hasStats = true;
                }
            }
            if (!hasStats && !isWingCollection) statsInfo = "<div>暫無詳細數值</div>";

            // Special handling for Wing Collection Tooltip
            if (isWingCollection) {
                if (!item.selectedWings || item.selectedWings.length === 0) {
                    statsInfo = "<div>請先勾選並選擇翅膀</div>";
                } else {
                    const count = item.selectedWings.length;
                    statsInfo = `<div style="margin-bottom:4px; color:var(--primary);">已選擇 ${count} 個翅膀加成:</div>`;

                    // List selected wings with colors, ensuring all are shown or scrollable
                    const wingsListHtml = item.selectedWings.map(wName => {
                        const w = WING_DATABASE[wName];
                        const color = w ? getWingGradeColor(w.grade) : '#ccc';
                        return `<span style="color:${color}">${wName}</span>`;
                    }).join(', ');

                    statsInfo += `<div style="font-size:10px; color:#8b949e; margin-bottom:5px; white-space:normal; border-bottom:1px solid #333; padding-bottom:3px; line-height:1.4; max-height:80px; overflow-y:auto;">${wingsListHtml}</div>`;

                    statsInfo += `<div style="margin-bottom:4px; color:#ccc;">數值總計:</div>`;
                    for (let s in item.stats) {
                        statsInfo += `<div>${s}: <span style="color:#fff;">+${Math.round(item.stats[s] * 1000) / 1000}</span></div>`;
                    }
                }
            }
        } // end else (not isFlag)

        return `
                    <div style="position:relative; display:flex; align-items:center;" class="custom-tooltip-trigger">
                        <label style="display:flex; align-items:center; cursor:pointer; gap:6px; user-select:none;">
                            <input type="checkbox" ${checked} onchange="toggleGainEffect('${key}', this.checked)" style="accent-color:var(--gold); width:16px; height:16px;">
                            <span style="font-size:12px; color:${item.active ? '#fff' : '#8b949e'}">${key}</span>
                        </label>
                        <span style="margin-left:5px; cursor:help; font-size:12px; color:#58a6ff; opacity:0.8;">ⓘ</span>
                        
                        <!-- Tooltip -->
                        <div class="custom-tooltip-content" style="
                            display: none;
                            position: absolute;
                            top: 130%;
                            left: 50%;
                            transform: translateX(-50%);
                            background: rgba(15, 20, 25, 0.98);
                            border: 1px solid var(--border);
                            border-radius: 6px;
                            padding: 10px;
                            width: 280px;
                            z-index: 1002;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                            pointer-events: none;
                            font-size: 12px;
                            color: #8b949e;
                            text-align: left;
                            white-space: normal;
                            word-break: break-word;
                        ">
                            <b style="color:var(--gold); display:block; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px; padding-bottom:5px;">${key} 加成細項</b>
                            <div style="line-height: 1.5; word-break: break-word;">${statsInfo}</div>
                            <!-- Arrow -->
                            <div style="position:absolute; bottom:100%; left:50%; transform:translateX(-50%); border-width:6px; border-style:solid; border-color:transparent transparent rgba(15,20,25,0.98) transparent;"></div>
                        </div>
                    </div>
                `;
    }).join('');


    // 翅膀選擇 UI 獨立渲染到 wing-selection-row（不影響 checkbox flex 排版）
    const wingRow = document.getElementById('wing-selection-row');
    if (wingRow) {
        const wingItem = GAIN_EFFECT_DATABASE['翅膀收藏'];
        if (wingItem && wingItem.active) {
            const allWings = Object.keys(WING_DATABASE).filter(k => WING_DATABASE[k].hold);
            allWings.sort((a, b) => {
                const gradeVal = { 'myth': 6, 'ancient': 5, 'unique': 4, 'special': 3, 'legend': 2, 'epic': 2, 'heroic': 2, 'rare': 1, 'common': 0 };
                const valA = gradeVal[WING_DATABASE[a].grade] || 0;
                const valB = gradeVal[WING_DATABASE[b].grade] || 0;
                return valB - valA;
            });
            const optionsHtml = allWings.map(wName => {
                const w = WING_DATABASE[wName];
                const isSel = wingItem.selectedWings.includes(wName) ? 'checked' : '';
                const color = w ? getWingGradeColor(w.grade) : '#ccc';
                return `
                            <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; border-radius:4px; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="checkbox" ${isSel} onchange="toggleWingItem('${wName}', this.checked)" style="accent-color:var(--primary); width:14px; height:14px; cursor:pointer;">
                                <span style="color:${color}; font-size:12px; font-weight:500;">${wName}</span>
                            </label>
                        `;
            }).join('');
            wingRow.style.display = 'block';
            wingRow.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <span style="font-size:12px; color:#8b949e;">🪽 翅膀選擇：</span>
                            <div style="position:relative; display:inline-block;">
                                <button id="wing-select-btn" onclick="const d = document.getElementById('wing-dropdown-list'); d.style.display = d.style.display === 'none' ? 'block' : 'none';"
                                    style="background:rgba(255,255,255,0.1); border:1px solid var(--border); color:#fff; cursor:pointer; font-size:11px; padding:3px 8px; border-radius:3px;">
                                    選擇翅膀 (${wingItem.selectedWings.length}) ▼
                                </button>
                                <div id="wing-dropdown-list" onclick="event.stopPropagation()" style="
                                    display:none;
                                    position:absolute;
                                    top:100%;
                                    left:0;
                                    background: #161b22;
                                    border: 1px solid var(--border);
                                    padding: 8px;
                                    z-index: 1001;
                                    min-width: 180px;
                                    max-height: 300px;
                                    overflow-y: auto;
                                    border-radius: 4px;
                                    box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                                ">
                                    <div style="border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; margin-bottom:5px;">
                                        <button onclick="event.stopPropagation(); clearAllWings()" style="width:100%; background:rgba(255,68,68,0.15); border:1px solid rgba(255,68,68,0.3); color:#ff6b6b; cursor:pointer; font-size:11px; padding:4px; border-radius:3px;">一鍵清除 🗑️</button>
                                    </div>
                                    ${optionsHtml}
                                </div>
                            </div>
                            <span id="selected-wings-display" style="font-size:11px; color:#58a6ff;">${wingItem.selectedWings.length > 0 ? wingItem.selectedWings.map(wName => { const w = WING_DATABASE[wName]; const c = w ? getWingGradeColor(w.grade) : '#ccc'; return `<span style="color:${c}">${wName}</span>`; }).join('<span style="color:#8b949e;">、</span>') : '尚未選擇'}</span>
                        </div>
                    `;
        } else {
            wingRow.style.display = 'none';
            wingRow.innerHTML = '';
        }
    }

    // Register hover events
    const triggers = container.querySelectorAll('.custom-tooltip-trigger');
    triggers.forEach(t => {
        const tooltip = t.querySelector('.custom-tooltip-content');
        // Prevent tooltip if clicking inside the wing dropdown
        t.onmouseenter = (e) => {
            if (e.target.closest('#wing-dropdown-list')) return;
            if (tooltip) tooltip.style.display = 'block';
        };
        t.onmouseleave = () => { if (tooltip) tooltip.style.display = 'none'; };
    });

    // Global click listener for closing dropdown (ensure only one is attached)
    if (!window._wingDropdownListenerAttached) {
        window.addEventListener('click', function (event) {
            const dropdown = document.getElementById('wing-dropdown-list');
            const button = document.getElementById('wing-select-btn');
            if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
                dropdown.style.display = 'none';
            }
        });
        window._wingDropdownListenerAttached = true;
    }
    // 📱 手機版預設收合增益效果面板
    if (window.innerWidth <= 768) {
        const geBody = document.getElementById('ge-body');
        const geArrow = document.getElementById('ge-arrow');
        if (geBody && !window._geInitialCollapseApplied) {
            geBody.style.display = 'none';
            if (geArrow) geArrow.style.transform = 'rotate(-90deg)';
            window._geInitialCollapseApplied = true;
        }
    }
}

window.toggleGainEffect = function (key, isChecked) {
    if (GAIN_EFFECT_DATABASE[key]) {
        GAIN_EFFECT_DATABASE[key].active = isChecked;

        // 💾 儲存所有增益狀態到 localStorage
        const states = {};
        Object.keys(GAIN_EFFECT_DATABASE).forEach(k => {
            states[k] = GAIN_EFFECT_DATABASE[k].active;
        });
        localStorage.setItem('gainEffectStates_v1', JSON.stringify(states));

        // Special handling for Wing Collection or flag-type toggles
        const dbItem = GAIN_EFFECT_DATABASE[key];
        if (key === '翅膀收藏' || dbItem._isFlag) {
            if (key === '翅膀收藏') initGainControls();
            // Also handle data update
            if (window.__LAST_DATA_JSON__) {
                processData(window.__LAST_DATA_JSON__, true, true, true);
            }
            return;
        }

        // Update UI directly without re-rendering the whole list
        const inputs = document.querySelectorAll('#ge-checkbox-container input[type="checkbox"]');
        inputs.forEach(input => {
            const span = input.nextElementSibling;
            if (span && span.textContent.trim() === key) {
                span.style.color = isChecked ? '#fff' : '#8b949e';
            }
        });

        // Re-process data (Stats Only)
        if (window.__LAST_DATA_JSON__) {
            processData(window.__LAST_DATA_JSON__, true, true, true);
        }
    }
};

window.toggleWingItem = function (wingName, isAdded) {
    const key = '翅膀收藏';
    if (GAIN_EFFECT_DATABASE[key]) {
        const item = GAIN_EFFECT_DATABASE[key];
        if (!item.selectedWings) item.selectedWings = [];

        if (isAdded) {
            if (!item.selectedWings.includes(wingName)) item.selectedWings.push(wingName);
        } else {
            item.selectedWings = item.selectedWings.filter(w => w !== wingName);
        }

        // Update localStorage
        localStorage.setItem('ownedWings', JSON.stringify(item.selectedWings));

        // Recalculate Total Stats
        let totalStats = {};
        item.selectedWings.forEach(wName => {
            const w = WING_DATABASE[wName];
            if (w && w.hold) {
                for (let statName in w.hold) {
                    let val = w.hold[statName];
                    let absVal = Math.abs(val);
                    let isDecimal = (absVal > 0 && absVal < 1);

                    // 根據關鍵字強制視為百分比 (除了小數判定外)
                    const percentKeywords = ['增幅', '增加', '減少', '率', '耐性'];
                    const matchesKeyword = percentKeywords.some(k => statName.includes(k));

                    if (isDecimal) val = val * 100;

                    // 標準化屬性名稱 (確保 UI 與核心計算一致)
                    let normName = normalizeKey(statName, (isDecimal || matchesKeyword));
                    normName = normName.replace(/PvE/i, 'PVE').replace(/PvP/i, 'PVP');

                    if (!totalStats[normName]) totalStats[normName] = 0;
                    totalStats[normName] += val;
                }
            }
        });
        item.stats = totalStats;

        // Update UI text directly to avoid closing dropdown
        const btn = document.getElementById('wing-select-btn');
        if (btn) btn.innerHTML = `選擇翅膀 (${item.selectedWings.length}) ▼`;

        // Update selected list text
        // Find the span next to the dropdown container
        const container = document.getElementById('wing-dropdown-container');
        if (container) {
            const listText = container.nextElementSibling;
            if (listText) {
                listText.textContent = item.selectedWings.length > 0 ? item.selectedWings.join('、') : '尚未選擇';
            }
        }

        // Do NOT call initGainControls() here, as it rebuilds the DOM and closes the dropdown.

        // Recalculate global stats
        if (window.__LAST_DATA_JSON__) {
            // processData(json, skipScroll, skipWingRender, statsOnly)
            // We need statsOnly=true to update the numbers without full page re-render
            processData(window.__LAST_DATA_JSON__, true, true, true);
        }
        // Keep 'item' in scope for the tooltip update logic below
        // Update Tooltip Content Manually
        const tooltipContainer = document.getElementById('ge-checkbox-container');
        if (tooltipContainer) {
            // Find the tooltip related to wing collection. 
            // The label text is just the key "翅膀收藏", so we look for that.
            const helpIconWrapper = Array.from(tooltipContainer.querySelectorAll('.custom-tooltip-trigger')).find(el => {
                const span = el.querySelector('span'); // The label span
                return span && span.textContent.trim() === '翅膀收藏';
            });

            if (helpIconWrapper) {
                const tooltipContent = helpIconWrapper.querySelector('.custom-tooltip-content');
                if (tooltipContent) {
                    let newHtml = `<b style="color:var(--gold); display:block; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px; padding-bottom:5px;">翅膀收藏 加成細項(持有)</b>`;

                    let statsInfo = "";
                    if (item.selectedWings.length === 0) {
                        statsInfo = "<div>請先勾選並選擇翅膀</div>";
                    } else {
                        const count = item.selectedWings.length;
                        statsInfo = `<div style="margin-bottom:4px; color:var(--primary);">您的裝備稱號已預設 ${count} 個翅膀</div>`;

                        // Add colored wing names
                        const wingsListHtml = item.selectedWings.map(wName => {
                            const w = WING_DATABASE[wName];
                            const color = w ? getWingGradeColor(w.grade) : '#ccc';
                            return `<span style="color:${color}">${wName}</span>`;
                        }).join(', ');

                        statsInfo += `<div style="font-size:10px; color:#8b949e; margin-bottom:5px; white-space:normal; border-bottom:1px solid #333; padding-bottom:3px; line-height:1.4; max-height:80px; overflow-y:auto;">${wingsListHtml}</div>`;

                        statsInfo += `<div style="margin-bottom:4px; color:#ccc;">數值總計:</div>`;
                        for (let s in totalStats) {
                            statsInfo += `<div>${s}: <span style="color:#fff;">+${Math.round(totalStats[s] * 1000) / 1000}</span></div>`;
                        }
                    }
                    newHtml += `<div style="line-height: 1.5">${statsInfo}</div>`;
                    newHtml += `<div style="position:absolute; top:100%; left:50%; transform:translateX(-50%); border-width:6px; border-style:solid; border-color:rgba(15,20,25,0.98) transparent transparent transparent;"></div>`;

                    tooltipContent.innerHTML = newHtml;
                }
            }
        }
        // Update Button Text Dynamically
        const finalBtn = document.getElementById('wing-select-btn');
        if (finalBtn) {
            finalBtn.innerHTML = `選擇翅膀 (${item.selectedWings.length}) ▼`;
        }
        // Update selected wings display text in wing-selection-row
        const wingDisplaySpan = document.getElementById('selected-wings-display');
        if (wingDisplaySpan) {
            if (item.selectedWings.length > 0) {
                wingDisplaySpan.innerHTML = item.selectedWings.map(wName => {
                    const w = WING_DATABASE[wName];
                    const c = w ? getWingGradeColor(w.grade) : '#ccc';
                    return `<span style="color:${c}">${wName}</span>`;
                }).join('<span style="color:#8b949e;">、</span>');
            } else {
                wingDisplaySpan.textContent = '尚未選擇';
            }
        }
    }
};

window.clearAllWings = function () {
    const key = '翅膀收藏';
    if (GAIN_EFFECT_DATABASE[key]) {
        GAIN_EFFECT_DATABASE[key].selectedWings = [];
        localStorage.setItem('ownedWings', JSON.stringify([]));

        // 更新 Tooltip 數據 (清除緩存的屬性)
        GAIN_EFFECT_DATABASE[key].stats = {};

        // 重新渲染控制項與數據
        initGainControls();

        // 🌟 重要：重新渲染後，手動顯示下拉選單，避免被重置為隱藏
        const dropdown = document.getElementById('wing-dropdown-list');
        if (dropdown) dropdown.style.display = 'block';

        if (window.__LAST_DATA_JSON__) {
            processData(window.__LAST_DATA_JSON__, true, true, true);
        }
    }
};

// --- 核心解析邏輯 (保持不變) ---
function getCorrectIcon(path) {
    if (!path) return "";
    // 如果已經是完整的 http 開頭，需確保經過代理以利截圖 (html2canvas CORS 要求)
    if (path.startsWith('http')) {
        // 若已經代理過則直接返回，避免重複代理
        if (path.includes('proxy.kk69347321.workers.dev')) return path;
        return getProxyUrl(path);
    }
    // 補齊本地資源路徑並代理
    let cleanPath = path.replace(/^\//, '');
    if (!cleanPath.includes('.')) cleanPath += '.png';
    return getProxyUrl(cleanPath);
}

/**
 * 取得本地職業圖示路徑
 */
function getLocalClassIcon(className) {
    if (!className) return "";
    const mapping = {
        "劍星": "gladiator.png",
        "守護星": "templar.png",
        "殺星": "assassin.png",
        "弓星": "ranger.png",
        "魔道星": "sorcerer.png",
        "精靈星": "elementalist.png",
        "治癒星": "cleric.png",
        "護法星": "chanter.png"
    };
    const fileName = mapping[className];
    if (fileName) return `./icon/${fileName}`;
    return "";
}

// 獨立渲染健檢分析 UI 函數
function renderHealthCheckUI(analysis) {
    const container = document.getElementById('health-check-container');
    if (!container) return; // 容錯

    if (!analysis || !Array.isArray(analysis) || analysis.length === 0) {
        container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #8b949e;">
                        <div style="font-size: 40px; margin-bottom: 10px;">🤔</div>
                        <div>暫無分析資料</div>
                    </div>
                `;
        return;
    }

    const mainReview = analysis[0];
    const suggestions = analysis.slice(1);
    let html = '';

    // 1. 總評卡片 (Premium UI)
    if (mainReview) {
        html += `
                    <div style="
                        background: radial-gradient(circle at top right, rgba(255, 215, 0, 0.1), transparent 40%), 
                                    linear-gradient(180deg, rgba(30, 30, 40, 0.8) 0%, rgba(20, 20, 30, 0.95) 100%);
                        border: 1px solid rgba(255, 215, 0, 0.3);
                        box-shadow: 0 4px 20px rgba(0,0,0,0.5), inset 0 0 30px rgba(255, 215, 0, 0.05);
                        border-radius: 12px;
                        padding: 25px;
                        margin-bottom: 25px;
                        position: relative;
                        overflow: hidden;
                    ">
                        <div style="position: relative; z-index: 2;">
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                                <span style="font-size: 24px;">📝</span>
                                <span style="font-size: 20px; font-weight: bold; color: var(--gold-bright); letter-spacing: 1px;">${mainReview.title || '綜合評價'}</span>
                            </div>
                            <div style="
                                font-size: 14px; 
                                color: #e0e0e0; 
                                line-height: 1.7; 
                                padding: 15px; 
                                background: rgba(255, 255, 255, 0.05); 
                                border-radius: 8px; 
                                border-left: 3px solid var(--gold);
                            ">
                                ${mainReview.desc || '暫無描述'}
                            </div>
                        </div>
                    </div>
                `;
    }

    // 2. 建議列表
    if (suggestions.length > 0) {
        html += `
                    <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 16px; font-weight: bold; color: #fff;">📋 優化建議項目</span>
                        <span style="font-size: 12px; color: #8b949e;">共 ${suggestions.length} 項</span>
                    </div>
                    <div style="display: grid; gap: 12px;">
                `;

        suggestions.forEach(item => {
            if (!item) return;

            // 根據優先級設定顏色與圖標
            let borderColor = '#3498db'; // 藍 (低)
            let bgGradient = 'linear-gradient(90deg, rgba(52, 152, 219, 0.1), transparent)';
            let icon = '💡';
            let badgeText = '建議';
            let badgeColor = '#3498db';

            if (item.priority === '高') {
                borderColor = '#e74c3c'; // 紅
                bgGradient = 'linear-gradient(90deg, rgba(231, 76, 60, 0.15), transparent)';
                icon = '🔥';
                badgeText = '優先改善';
                badgeColor = '#ff6b6b';
            } else if (item.priority === '中') {
                borderColor = '#f1c40f'; // 黃
                bgGradient = 'linear-gradient(90deg, rgba(241, 196, 15, 0.1), transparent)';
                icon = '⚡';
                badgeText = '推薦調整';
                badgeColor = '#f1c40f';
            } else if (item.priority === '無' || item.priority === '完成') {
                borderColor = '#2ecc71'; // 綠
                bgGradient = 'linear-gradient(90deg, rgba(46, 204, 113, 0.1), transparent)';
                icon = '✅';
                badgeText = '已達成';
                badgeColor = '#2ecc71';
            }

            html += `
                        <div style="
                            background: ${bgGradient};
                            border-left: 4px solid ${borderColor};
                            border-radius: 6px;
                            padding: 15px;
                            border-top: 1px solid rgba(255,255,255,0.05);
                            border-right: 1px solid rgba(255,255,255,0.05);
                            border-bottom: 1px solid rgba(255,255,255,0.05);
                            transition: transform 0.2s;
                        " onmouseover="this.style.transform='translateX(3px)'" onmouseout="this.style.transform='translateX(0)'">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 18px;">${icon}</span>
                                    <span style="font-weight: bold; color: #fff; font-size: 15px;">${item.title}</span>
                                </div>
                                <span style="
                                    font-size: 10px; 
                                    padding: 2px 8px; 
                                    border-radius: 10px; 
                                    background: rgba(0,0,0,0.3); 
                                    color: ${badgeColor}; 
                                    border: 1px solid ${borderColor};
                                    white-space: nowrap;
                                ">${badgeText}</span>
                            </div>
                            <div style="font-size: 13px; color: #b0b8c3; line-height: 1.5; padding-left: 4px;">
                                ${item.desc}
                            </div>
                        </div>
                    `;
        });

        html += '</div>';
    } else {
        html += `
                    <div style="text-align: center; padding: 30px; background: rgba(255,255,255,0.02); border-radius: 8px;">
                        <span style="font-size: 30px;">🎉</span>
                        <div style="margin-top: 10px; color: #2ecc71;">完美無瑕！目前沒有其他優化建議。</div>
                    </div>
                `;
    }

    container.innerHTML = html;
}


function getGradeColor(grade) {
    if (!grade) return '#ffffff';

    // 優先處理數字 grade (QuestLog API: 51/41/31/21/11)
    const gradeNum = parseInt(grade);
    if (!isNaN(gradeNum) && gradeNum >= 11) {
        if (gradeNum >= 51) return '#e67e22'; // 神話/古代 (橙)
        if (gradeNum >= 41) return '#f1c40f'; // 唯一/獨特 (金)
        if (gradeNum >= 31) return '#3498db'; // 傳說 (藍)
        if (gradeNum >= 21) return '#2ecc71'; // 稀有 (綠)
        return '#ffffff';                      // 普通 (白)
    }

    // 字串 grade 判斷 (角色 API)
    const g = String(grade).toLowerCase();
    switch (g) {
        case 'myth': case '神話': case 'ancient': case '古代': return '#e67e22';
        case 'unique': case '唯一': case '獨特': return '#f1c40f';
        case 'special': return '#00ffcc';
        case 'legend': case '傳說': case '傳承': case 'epic': case '史詩': return '#3498db';
        case 'rare': case '稀有': return '#2ecc71';
        case 'common': case '一般': case 'normal': case '普通': return '#ffffff';
        default: return '#ffffff';
    }
}

// 渲染排名資訊
function renderRankings(rankingList, gameRankings) {
    const container = document.getElementById('p-ranking-container');
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    // 排名類型對應表
    const rankingTypes = {
        1: '深淵',
        3: '惡夢',
        4: '超越',
        5: '單人競技',
        6: '協力競技',
        20: '討伐戰',
        21: '覺醒戰'
    };

    const rankingIcons = {
        '深淵': '⚔️',
        '惡夢': '👹',
        '超越': '⭐',
        '單人競技': '🎯',
        '協力競技': '🤝',
        '討伐戰': '⚡',
        '覺醒戰': '💫'
    };

    let hasValidRanking = false;
    let rankings = [];

    // 優先使用新格式的 gameRankings
    if (gameRankings && Object.keys(gameRankings).length > 0) {
        Object.entries(gameRankings).forEach(([typeId, data]) => {
            if (data && data.rank) {
                const typeName = rankingTypes[typeId] || `類型${typeId}`;
                rankings.push({
                    rankingContentsName: typeName,
                    rank: data.rank,
                    score: data.score,
                    seasonId: data.seasonId
                });
                hasValidRanking = true;
            }
        });
    }
    // 如果沒有新格式,嘗試使用舊格式的 rankingList
    else if (rankingList && rankingList.length > 0) {
        rankingList.forEach(ranking => {
            if (ranking.rank !== null && ranking.rank !== undefined) {
                rankings.push(ranking);
                hasValidRanking = true;
            }
        });
    }

    if (!hasValidRanking) {
        container.innerHTML = '<div style="color: #8b949e; font-size: 14px; margin-top: 10px;">📊 暫無排名資料</div>';
        return;
    }

    // 渲染排名資料 - 使用與百分位數相同的樣式
    container.innerHTML = '';
    const rankingWrapper = document.createElement('div');
    rankingWrapper.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; font-size: 14px; margin-top: 15px;';

    rankings.forEach(ranking => {
        const badge = document.createElement('span');
        badge.style.cssText = 'background: linear-gradient(145deg, rgba(26, 35, 50, 0.6), rgba(15, 25, 34, 0.4)); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; color: #e6edf3; transition: all 0.3s ease; white-space: nowrap;';

        // 計算排名變化
        let rankChangeHtml = '';
        if (ranking.rankChange !== null && ranking.rankChange !== undefined && ranking.rankChange !== 0) {
            const changeColor = ranking.rankChange > 0 ? '#ff6c6c' : '#3fb950';
            const changeSymbol = ranking.rankChange > 0 ? '▲' : '▼';
            rankChangeHtml = ` <span style="color: ${changeColor}; font-size: 12px; margin-left: 4px;">${changeSymbol}${Math.abs(ranking.rankChange)}</span>`;
        }

        badge.innerHTML = `
                    <span style="color: #8b949e; font-size: 13px;">${ranking.rankingContentsName}</span>
                    <span style="color: var(--gold-bright); font-weight: bold; font-size: 16px; margin-left: 6px;">#${ranking.rank}</span>${rankChangeHtml}
                `;

        // hover 效果
        badge.addEventListener('mouseenter', function () {
            this.style.borderColor = 'var(--primary)';
            this.style.boxShadow = '0 4px 15px rgba(88, 166, 255, 0.3)';
            this.style.transform = 'translateY(-2px)';
        });
        badge.addEventListener('mouseleave', function () {
            this.style.borderColor = 'var(--border)';
            this.style.boxShadow = 'none';
            this.style.transform = 'translateY(0)';
        });

        rankingWrapper.appendChild(badge);
    });

    container.appendChild(rankingWrapper);
}



// 輔助渲染函數 (維持不變)

// 🟢 標準化屬性名稱 (確保 被動技能 與 主表 欄位對齊)
// 🟢 標準化屬性名稱 (確保 被動技能 與 主表 欄位對齊)
function normalizeKey(name, forcePerc = null) {
    // 🚫 嚴格區分：哪些屬性「永遠」是百分比
    const alwaysPercent = ['戰鬥速度', '移動速度', '攻擊速度', '飛行速度', '暴擊傷害增幅', '物理致命一擊', '魔法致命一擊', '暴擊抵抗增加', '強擊', '多段打擊', '完美', '再生', '鐵壁', '冷卻時間', '傷害增幅', '傷害耐性', '武器傷害增幅', '後方傷害增幅'];
    const protectPercNames = ['攻擊力增加', '生命力增加', '精神力增加', '防禦力增加', '命中增加', '迴避增加', '暴擊增加', '格擋增加', '暴擊抵抗增加'];

    let cleanName = name.replace('%', '').replace(/\s+/g, '').trim();
    // 🚨 強制修正：PVE/PVP 大寫統一
    cleanName = cleanName.replace(/PvE/i, 'PVE').replace(/PvP/i, 'PVP');

    // 贅字清理 (保護名單除外)
    if (!protectPercNames.includes(cleanName)) {
        cleanName = cleanName.replace(/(增加|提升|提高|增加量|增加%|提升%|提高%|增加量%)$/g, '').trim();
    }

    if (cleanName === '暴擊抵抗') return '暴擊抵抗';

    // 如果明確指定
    if (forcePerc === true) return cleanName + '%';
    if (forcePerc === false) return cleanName;

    // 自動判定：僅當原始名稱含 % 才保留
    if (name.includes('%')) {
        return cleanName + '%';
    }
    return cleanName;
}



function processData(json, skipScroll = false, skipWingRender = false, statsOnly = false) {
    // 儲存當前數據以利即時重新渲染
    window.__LAST_DATA_JSON__ = json;

    // 初始化摺疊狀態（預設收合）
    const wingCollapsed = localStorage.getItem('wingCollectionCollapsed') !== 'false';
    const wrapper = document.getElementById('wing-collection-wrapper');
    const header = document.getElementById('wing-collection-header');
    if (wrapper && header) {
        if (wingCollapsed) {
            wrapper.classList.add('collapsed');
            header.classList.add('collapsed');
        } else {
            wrapper.classList.remove('collapsed');
            header.classList.remove('collapsed');
        }
    }

    // 從 API 回傳的結果中抓取時間
    const apiUpdateTime = json.queryTimestamp || (json.queryResult ? json.queryResult.queryTimestamp : null);
    window.__LAST_UPDATE_TIME__ = apiUpdateTime; // 持久化供佈覽使用

    // 兼容不同的數據結構層次
    const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
    if (!data || !data.profile) { alert("無法在結果中找到有效的角色數據!"); return; }

    const rating = json.rating || (json.queryResult ? json.queryResult.rating : null);

    // 🛡️ Robust Ratings Extraction
    // Check multiple paths: queryResult.ratings (New API), data.ratings, rating.ratings, json.ratings
    const ratingsData = (json.queryResult && json.queryResult.ratings) ? json.queryResult.ratings :
        (json.ratings ? json.ratings :
            ((data && data.ratings) ? data.ratings :
                ((rating && rating.ratings) ? rating.ratings : null)));



    // [RatingDebug] 已移除 log

    // Update Stat Header ID and Score
    if (!statsOnly) {
        const headerIdEl = document.getElementById('stat-header-char-id');
        const headerScoreEl = document.getElementById('stat-header-score');

        // Find ItemLevel from stat list
        const itemLvObj = data.stat.statList.find(s => s.type === "ItemLevel");
        const pItemLv = itemLvObj ? itemLvObj.value : "--";

        if (headerIdEl) headerIdEl.textContent = data.profile.characterName || "--";
        if (headerScoreEl) headerScoreEl.textContent = (typeof pItemLv === 'number') ? pItemLv.toLocaleString() : pItemLv;
    }

    document.getElementById('main-content').style.display = 'flex';

    // ⚔️ 載入數據後顯示下方區塊
    const collectionContent = document.getElementById('nav-target-collection');
    if (collectionContent) collectionContent.style.display = 'block';

    // 🛡️ 核心修復：更新被動技能增益效果
    // 只有在非「僅更新統計」的情況（如重新搜尋）才解析技能，防止勾選開關時導致數據跳回預設值。
    if (!statsOnly) {
        updatePassiveSkills(data);
    }

    // 重新渲染增益效果控制項以更新 Tooltip (包含新的 breakdown 資訊)
    // 但如果翅膀下拉選單目前是開啟的，跳過重繪以避免關閉選單
    const _wingDropdown = document.getElementById('wing-dropdown-list');
    const _isDropdownOpen = _wingDropdown && _wingDropdown.style.display !== 'none';
    if (!_isDropdownOpen) {
        initGainControls();
    }

    // 使用變數暫存 HTML，避免直接操作 DOM 造成抖動
    let arcanaGridHtml = "";
    let setBonusGridHtml = "";
    let equipSourceGridHtml = "";
    let equipSourceGrid = document.getElementById('equip-source-grid');


    // --- 更新 Header UI ---
    if (!statsOnly) {
        const pH = document.getElementById('new-profile-header');
        if (pH) {
            pH.style.display = 'flex';
            // 安全檢查 profileImage
            const pImg = getCorrectIcon((data.profile && data.profile.profileImage) ? data.profile.profileImage : "");
            const pName = data.profile.characterName;
            const pTitle = data.profile.titleName || "無稱號";
            const pServer = data.profile.serverName;
            const pLv = data.profile.characterLevel;
            const pClass = data.profile.className;
            const pClassIcon = getLocalClassIcon(pClass) || getCorrectIcon(data.profile.classIcon || "");
            const pLegion = data.profile.legionName; // 軍團

            // 找出道具等級
            const itemLvObj = data.stat.statList.find(s => s.type === "ItemLevel");
            const pItemLv = itemLvObj ? itemLvObj.value : "--";

            // 更新時間格式化
            let updateTimeStr = "API 未提供";
            if (apiUpdateTime) {
                const d = new Date(apiUpdateTime);
                updateTimeStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            }

            pH.innerHTML = `
                        <div class="profile-left">
                            <div class="profile-avatar-wrapper">
                                <img class="profile-img-lg" src="${pImg}">
                                <div class="profile-lv-badge">Lv.${pLv}</div>
                            </div>
                            <div class="profile-info">
                                <div class="profile-name-row">
                                    <span class="p-name-lg">${pName}</span>
                                </div>
                                <div class="profile-meta-grid">
                                    <div class="meta-item">
                                        <span class="meta-text">${pServer} | ${pLegion || "無公會"}</span>
                                    </div>
                                    <div class="meta-item">
                                        <span class="meta-icon">${pClassIcon ? `<img src="${pClassIcon}" style="width:16px; height:16px; position: relative; top: 1px;">` : '⚔️'}</span>
                                        <span class="meta-text">${pClass}</span>
                                    </div>
                                    ${(pTitle && pTitle !== "無稱號") ? `
                                    <div class="meta-item">
                                        <span class="meta-icon">🎖️</span>
                                        <span class="meta-text">${pTitle}</span>
                                    </div>` : ''}
                                    <div id="abyss-badge-new" class="meta-item abyss-rank" style="display:none;">
                                        <span class="meta-icon">🏆</span>
                                        <span class="meta-text"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="profile-right">
                            <div class="update-time-pill" title="官方數據更新時間" style="margin-left: auto;">
                                <span class="update-icon">API更新時間</span> ${updateTimeStr}
                            </div>
                        </div>
                    `;

            // 深淵階級處理
            const abyssRanking = (data.ranking && data.ranking.rankingList)
                ? data.ranking.rankingList.find(r => r.rankingContentsName === '深淵' || r.rankingContentsType === 1)
                : null;
            if (abyssRanking && abyssRanking.gradeName) {
                const abBadge = document.getElementById('abyss-badge-new');
                if (abBadge) {
                    abBadge.style.display = 'flex';
                    const textSpan = abBadge.querySelector('.meta-text');
                    if (textSpan) textSpan.innerText = abyssRanking.gradeName;
                }
            }
        }

        // --- 更新 排名 UI (Grid) 並作為趨勢圖切換卡片 ---
        const rankContainer = document.getElementById('p-ranking-new');
        // 整合新舊格式排名
        const gameRankings = json.gameRankings || (json.queryResult ? json.queryResult.gameRankings : null);
        const rankingList = data.ranking ? data.ranking.rankingList : [];
        let allRankings = [];

        // 預先解析 rating 用於裝備等級卡片
        // 預先解析 rating 用於裝備等級卡片
        // const rating = json.rating || (json.queryResult ? json.queryResult.rating : null); // Moved to top

        // 0. 加入 [裝備等級] 卡片作為第一個按鈕
        const itemPercentile = (rating && rating.percentile) ? rating.percentile.itemScoreRangePercentile : "--";
        // 數值顯示 Item Score
        const itemLvObj = data.stat.statList.find(s => s.type === "ItemLevel");
        const itemLvVal = itemLvObj ? itemLvObj.value : "--";

        allRankings.push({
            rankingContentsName: "裝備等級",
            valDisplay: itemLvVal,
            subVal: "",
            rankChange: 0,
            trendId: 'itemLevel',
            isActive: true // 預設選中
        });

        // 1. 定義排名類型名稱對照表（必須在使用前定義）
        const rankingTypeNames = {
            1: '深淵',
            3: '惡夢',
            4: '超越',
            5: '單人競技',
            6: '協力競技',
            20: '討伐戰',
            21: '覺醒戰'
        };

        // 2. 合併 API 排名
        if (gameRankings && gameRankings.length > 0) {
            gameRankings.forEach(r => {
                // 確保有 rankingContentsName 和 trendId
                const typeId = r.rankingContentsType || r.type;
                const typeName = rankingTypeNames[typeId] || r.rankingContentsName || r.contentsName;

                allRankings.push({
                    rankingContentsName: typeName,
                    rank: r.rank || r.ranking,
                    rankChange: r.rankChange,
                    trendId: typeId // 使用數字 ID 作為 trendId
                });
            });
        } else if (rankingList && rankingList.length > 0) {
            rankingList.forEach(r => {
                const typeId = r.rankingContentsType || r.type;
                const typeName = r.rankingContentsName || rankingTypeNames[typeId];

                allRankings.push({
                    rankingContentsName: typeName,
                    rank: r.rank || r.ranking,
                    rankChange: r.rankChange,
                    trendId: typeId
                });
            });
        }

        // 3. 定義 ID 對照表（保持向後兼容）

        const trendMap = {
            '裝備等級': 'itemLevel',
            '深淵': 1, 'Abyss': 1,
            '惡夢': 3, 'Nightmare': 3,
            '超越': 4, 'Transcendence': 4,
            '單人競技': 5, 'Solo Arena': 5,
            '協力競技': 6, 'Coop Arena': 6,
            '討伐戰': 20, 'Raid': 20,
            '覺醒戰': 21, 'Awakening': 21
        };

        // 3. 定義切換函數 (全域)
        if (!window.switchTrendChart) {
            window.switchTrendChart = function (el, type) {
                document.querySelectorAll('.rank-card-new').forEach(c => c.classList.remove('active-rank'));
                if (el) el.classList.add('active-rank');
                // 為了視覺反饋，確保 active 樣式立即生效

                if (typeof renderTrendChart === 'function') {
                    // 使用最後一次成功的數據
                    renderTrendChart(window.__LAST_DATA_JSON__ || json, type);
                }
            };
        }

        if (rankContainer && allRankings.length > 0) {
            let rankHtml = "";
            allRankings.forEach(r => {
                const name = r.rankingContentsName || r.contentsName || "未知";
                const tId = r.trendId || trendMap[name] || null;
                const isClickable = !!tId;

                // 樣式處理
                const activeClass = r.isActive ? 'active-rank' : '';
                const cursorStyle = isClickable ? 'cursor: pointer;' : 'opacity: 0.8;';
                const clickAttr = isClickable ? `onclick="switchTrendChart(this, '${tId}')"` : '';

                // 數值顯示
                let mainVal = "", subVal = "";
                if (r.trendId === 'itemLevel') {
                    mainVal = r.valDisplay;
                    subVal = r.subVal;
                } else {
                    const rank = r.rank || r.ranking || 0;
                    mainVal = `#${rank.toLocaleString()}`;
                }

                // 變化顯示
                let diffHtml = '<span class="rc-diff diff-same">-</span>';
                const chg = r.rankChange;
                if (chg !== undefined && chg !== null && chg !== 0) {
                    if (chg > 0) diffHtml = `<span class="rc-diff diff-up">▲ ${chg}</span>`;
                    else diffHtml = `<span class="rc-diff diff-down">▼ ${Math.abs(chg)}</span>`;
                }

                rankHtml += `
                            <div class="rank-card-new ${activeClass}" style="${cursorStyle}" ${clickAttr} title="點擊查看趨勢">
                                <div class="rc-label" style="font-size:11px; color:rgba(255,255,255,0.7);">${name}</div>
                                <div class="rc-val" style="font-size: 18px; margin-top:2px;">${mainVal}</div>
                                ${subVal ? `<div style="font-size:11px; color:#64748b; margin-top:0px;">${subVal}</div>` : ''}
                                ${diffHtml}
                            </div>
                        `;
            });
            rankContainer.innerHTML = rankHtml;

            // 初始化圖表 (預設 itemLevel)
            setTimeout(() => {
                if (typeof renderTrendChart === 'function') renderTrendChart(json, 'itemLevel');
            }, 100);
        } else if (rankContainer) {
            rankContainer.innerHTML = `<div style="grid-column:1/-1; color:#666; font-size:12px; text-align:center; padding:10px;">無排名資料</div>`;
        }

        // --- 更新 百分比 UI ---
        const percentile = rating ? rating.percentile : null;
        const ptContainer = document.getElementById('p-percentile-new');

        if (percentile && ptContainer) {
            const items = [
                { label: "道具等級範圍", val: percentile.itemScoreRangePercentile, desc: percentile.itemScoreRange || "範圍" },
                { label: "伺服器排名", val: percentile.serverPercentile, desc: data.profile.serverName },
                { label: "職業排名", val: percentile.classPercentile, desc: data.profile.className },
                { label: "全體排名", val: percentile.allDataPercentile, desc: "全體玩家" }
            ];

            ptContainer.innerHTML = items.map(i => {
                const v = parseFloat(i.val);
                // 顏色：前10%金色，前30%藍色，其他灰藍
                const color = v <= 10 ? 'var(--gold)' : v <= 30 ? 'var(--primary)' : '#94a3b8';
                return `
                    <div class="rank-card-new" style="cursor:default;">
                        <div class="rc-label">${i.label}</div>
                        <div class="rc-val" style="font-size:18px; margin-top:2px; color:${color};">前 ${i.val}%</div>
                        <div style="font-size:11px; color:rgba(255,255,255,0.45); margin-top:2px;">${i.desc || ''}</div>
                    </div>
                `;
            }).join('');
        } else if (ptContainer) {
            ptContainer.innerHTML = '';
        }
    }


    let stats = {};
    let boardSkillMap = {};
    let cardSkillMap = {};
    let processedSets = new Set();
    let armorHtml = "";
    let accessoryHtml = "";
    let armorSimpleHtml = "";
    let accessorySimpleHtml = "";
    let titleHtml = "";

    const getEntry = (k) => {
        if (!stats[k]) {
            stats[k] = {
                nezakan: 0, zikel: 0, baizel: 0, triniel: 0, malkutan: 0, ariel: 0, asphel: 0,
                equipMain: 0, equipSub: 0, other: 0,
                isPerc: k.includes('%'),
                detailGroups: {
                    base: [], random: [], stone: [], arcana: [], title: [],
                    set: [], skill: [], wing: [], wingHold: [], gainEffect: [],
                    mainStat: [], etc: []
                },
                subtotals: {
                    title: 0, mainStat: 0, arcana: 0, stone: 0, random: 0,
                    wing: 0, wingHold: 0, gainEffect: 0, set: 0, skill: 0
                }
            };
        }
        return stats[k];
    };



    let coreStatsForOverview = [];
    (data.stat.statList || []).forEach(s => {
        if (s.type === 'ItemLevel') return;

        // 1. Capture Official Total Value
        let possiblePerc = s.value.toString().includes('%');

        // 🌟 統一 Key 名稱，確保與板塊數據一致
        let keyName = s.name;
        if (keyName === '狀態異常抵抗' || keyName === '狀態抵抗') keyName = '異常狀態抵抗';
        if (keyName === '狀態異常擊中' || keyName === '狀態擊中') keyName = '異常狀態擊中';

        let key = normalizeKey(keyName, possiblePerc);
        let entry = getEntry(key);
        let valNum = parseFloat(s.value.toString().replace(/,/g, '').replace('%', ''));

        // 🚨 修正官方總值縮放 (1000 = 1% 類 vs 100 = 1% 類)
        const scale1000Keys = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
        const scale100Keys = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];

        if (possiblePerc && scale1000Keys.some(sk => keyName.includes(sk)) && Math.abs(valNum) >= 40) {
            valNum = valNum / 1000;
        } else if (possiblePerc && scale100Keys.some(sk => keyName.includes(sk)) && Math.abs(valNum) >= 20) {
            valNum = valNum / 100;
        }

        entry.total = valNum;
        // Mark this entry as having an official total so we don't zero it out later easily
        entry.hasOfficialTotal = true;

        // Collect for overview display
        coreStatsForOverview.push({
            name: s.name,
            value: s.value,
            descs: s.statSecondList || [],
            details: s.statSecondList ? s.statSecondList.map(d => `▹ ${d}`).join('<br>') : "無額外數據"
        });

        // 解析 statSecondList 並加入到屬性對帳總表
        if (s.statSecondList && s.statSecondList.length > 0) {
            s.statSecondList.forEach(statDesc => {
                // 解析格式: "屬性名稱 +數值%" 或 "屬性名稱 -數值%"
                const match = statDesc.match(/^(.+?)\s+([\+\-][\d\.]+%?)$/);
                if (match) {
                    let statName = match[1].trim();
                    let valueStr = match[2].trim();
                    let value = parseFloat(valueStr.replace('%', ''));

                    // 優先使用父層 statList 的 key（確保 key 一致性）
                    // 例如：statList 的 "攻擊力增加" key 是 "攻擊力增加"（無%），
                    // 而 statSecondList 的 "攻擊力增加 +17.3%" 若重新生成 key 會是 "攻擊力增加%"，造成分離
                    // 判斷：若 statName 與父層 s.name 相同（移除%後），使用父層 key
                    let cleanStatName = statName.replace('%', '').trim();
                    let cleanParentName = s.name.replace('%', '').trim();
                    let entryKey = (cleanStatName === cleanParentName) ? key : normalizeKey(statName, valueStr.includes('%'));

                    // 🚨 修正：精神力增加 (Flat) 誤判修正
                    // 如果 statName 是 "精神力增加" 且數值不是%，則必須是 "精神力增加" (Flat)，不能跟隨父層 "精神力"
                    if (statName === '精神力增加' && !valueStr.includes('%')) {
                        entryKey = '精神力增加';
                        // 防止父層如果是 "精神力"，導致被導向 "精神力"
                    }

                    // 🚨 修正：精神力 (Percent) 誤判修正
                    // 如果 statName 是 "精神力" 且數值是 %，則應歸類為 "精神力增加"
                    if (cleanStatName === '精神力' && valueStr.includes('%')) {
                        entryKey = '精神力增加';
                    }

                    let entry = getEntry(entryKey);
                    entry.other += value;
                    entry.subtotals.mainStat += value;
                    entry.detailGroups.mainStat.push(`[${s.name}]轉化: ${valueStr}`);
                }
            });
        } else {
            // 💡 修正：不再將官方總值直接加入 other/mainStat 欄位，避免與後續手動抓取的裝備數據重複計算
            // 僅保留 total 作為校對基準。
        }
        // 暫時移除此處的內容更新，改到 processData 末尾統一渲染
    });

    // 🌟 Manual Injection of Primary Stat Conversions (Will -> Resistance, Knowledge -> Accuracy)
    // The API sometimes misses these derived stats in the breakdown or total (especially Resistance).
    const primaryStatsToProcess = [
        { name: '意志', target: '異常狀態抵抗', ratio: 0.1, suffix: '%', label: '[意志]轉化' },
        { name: '知識', target: '異常狀態擊中', ratio: 0.1, suffix: '%', label: '[知識]轉化' }
    ];

    primaryStatsToProcess.forEach(p => {
        const pStat = (data.stat.statList || []).find(s => s.name === p.name);
        if (pStat) {
            const pVal = parseFloat(String(pStat.value).replace(/,/g, '').replace('%', ''));
            const bonus = parseFloat((pVal * p.ratio).toFixed(1));

            // 使用 normalizeKey 確保目標 key 與統一後的名稱一致
            const targetKey = normalizeKey(p.target);
            const targetEntry = getEntry(targetKey);

            // 檢查是否已經存在 (避免重複添加)
            // 💡 強化檢查：同時檢查 原始 Key 與 百分比 Key，防止 10.6% vs 21.2 的重複計算問題
            const altKey = targetKey.includes('%') ? targetKey.replace('%', '') : targetKey + '%';
            const altEntry = stats[altKey];

            const alreadyHas = targetEntry.detailGroups.mainStat.some(s => s.includes(p.name));
            const alreadyHasAlt = altEntry && altEntry.detailGroups.mainStat.some(s => s.includes(p.name));

            if (!alreadyHas && !alreadyHasAlt && bonus > 0) {
                targetEntry.other += bonus;
                targetEntry.subtotals.mainStat += bonus;
                targetEntry.detailGroups.mainStat.push(`${p.label}: +${bonus}${p.suffix}`);
            }
        }
    });

    // 處理板塊完成度資訊
    // console.log('檢查 data.daevanionBoard:', data.daevanionBoard);
    // console.log('檢查 data.daevanionBoardList:', data.daevanionBoardList);

    // 先設定預設內容
    const boardNames = {
        'nezakan': '奈薩肯',
        'zikel': '吉凱爾',
        'baizel': '白傑爾',
        'triniel': '崔妮爾',
        'ariel': '艾瑞爾',
        'asphel': '阿斯佩爾'
    };



    // 嘗試從多個可能的路徑獲取板塊列表
    let boardList = null;
    if (data.daevanionBoardList) {
        boardList = data.daevanionBoardList;
        //     console.log('從 data.daevanionBoardList 找到資料');
    } else if (data.daevanionBoard && data.daevanionBoard.daevanionBoardList) {
        boardList = data.daevanionBoard.daevanionBoardList;
        //     console.log('從 data.daevanionBoard.daevanionBoardList 找到資料');
    }

    let processedBoardNames = new Set();

    // 如果有實際資料,則更新
    if (boardList && boardList.length > 0) {
        const boardMap = {
            '奈薩肯': 'nezakan',
            '吉凱爾': 'zikel',
            '白傑爾': 'baizel',
            '崔妮爾': 'triniel',
            '艾瑞爾': 'ariel',
            '阿斯佩爾': 'asphel',
            '瑪爾庫坦': 'malkutan'
        };

        // console.log('板塊列表:', boardList);
        boardList.forEach(board => {
            let hasStats = false;
            // Process Stats
            if (board.detail && board.detail.openStatEffectList) {
                board.detail.openStatEffectList.forEach(ef => {
                    // 🌟 Robust Split 避免無空格導致解析失敗
                    let parts = ef.desc.split('+');
                    if (parts.length < 2) return;

                    let n = parts[0].trim();
                    let vS = parts[1].trim(); // Trim extra spaces

                    // 🚨 強制修正：異常狀態抵抗名稱標準化
                    if (n === '狀態異常抵抗' || n === '狀態抵抗') n = '異常狀態抵抗';
                    if (n === '狀態異常擊中' || n === '狀態擊中') n = '異常狀態擊中';

                    let isPerc = vS.includes('%');

                    // 🌟 強制歸類：這兩個屬性即使板塊給 %，也強制歸入 Flat 數值主條目
                    // 這樣才能與官方數值 (通常是整數) 合併顯示
                    if (n === '異常狀態抵抗' || n === '異常狀態擊中') {
                        isPerc = false;
                    }

                    let k = normalizeKey(n, isPerc);
                    let v = parseFloat(vS.replace('%', ''));

                    // 🌟 數值修正：如果數值過小 (說明是 0.18=18%)，則轉為整數
                    // 適用於所有百分比屬性 以及 被強制設為 Flat 的異常狀態屬性
                    if (Math.abs(v) < 1 && Math.abs(v) > 0) {
                        if (k.includes('%') || n === '異常狀態抵抗' || n === '異常狀態擊中') {
                            v = v * 100;
                        }
                    }

                    // 🚨 修正特定板塊數值 (1000 = 1% vs 100 = 1%)
                    const bSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                    const bSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                    if (bSc1000.some(bk => n.includes(bk)) && Math.abs(v) >= 40) {
                        v = v / 1000;
                    } else if (bSc100.some(bk => n.includes(bk)) && Math.abs(v) >= 20) {
                        v = v / 100;
                    }

                    let e = getEntry(k);

                    if (board.name.includes("奈薩肯")) e.nezakan += v;
                    else if (board.name.includes("吉凱爾")) e.zikel += v;
                    else if (board.name.includes("白傑爾")) e.baizel += v;
                    else if (board.name.includes("崔妮爾")) e.triniel += v;
                    else if (board.name.includes("艾瑞爾")) e.ariel += v;
                    else if (board.name.includes("阿斯佩爾")) e.asphel += v;
                    else if (board.name.includes("瑪爾庫坦")) e.malkutan += v;
                    else {
                        e.other += v;
                        e.subtotals.gainEffect += v;
                        // 📝 添加詳細來源說明 (僅非主神板塊)
                        e.detailGroups.gainEffect.push(`[板塊] ${board.name}: +${v}${isPerc ? '%' : ''}`);
                    }
                    hasStats = true;
                });
            }

            // Process Skills
            if (board.detail && board.detail.openSkillEffectList) {
                board.detail.openSkillEffectList.forEach(sk => {
                    let parts = sk.desc.split(' +');
                    if (parts.length >= 2) {
                        let sn = parts[0].trim(), sv = parts[1].trim();
                        boardSkillMap[sn] = (boardSkillMap[sn] || 0) + parseInt(sv);
                    }
                });
            }

            if (hasStats) {
                processedBoardNames.add(board.name);
            }
        });
    } else {
        // console.warn('API 未提供 daevanionBoardList 資料');
    }

    (data.daevanionDetails || []).forEach(b => {
        // 避免重複處理 (如果 boardList 已經處理過且有數據)
        if (processedBoardNames.has(b.boardName)) return;

        (b.detail?.openStatEffectList || []).forEach(ef => {
            // 🌟 Robust Split
            let parts = ef.desc.split('+');
            if (parts.length < 2) return;

            let n = parts[0].trim();
            let vS = parts[1].trim();

            // 🚨 強制修正：異常狀態抵抗/擊中名稱標準化
            if (n === '狀態異常抵抗' || n === '狀態抵抗') n = '異常狀態抵抗';
            if (n === '狀態異常擊中' || n === '狀態擊中') n = '異常狀態擊中';

            let isPerc = vS.includes('%');

            // 🌟 強制歸類：這兩個屬性即使板塊給 %，也強制歸入 Flat 數值主條目
            if (n === '異常狀態抵抗' || n === '異常狀態擊中') {
                isPerc = false;
            }

            let k = normalizeKey(n, isPerc);
            let v = parseFloat(vS.replace('%', ''));

            // 🌟 數值修正：如果數值過小 (說明是 0.18=18%)，則轉為整數
            // 適用於所有百分比屬性 以及 被強制設為 Flat 的異常狀態屬性
            if (Math.abs(v) < 1 && Math.abs(v) > 0) {
                if (k.includes('%') || n === '異常狀態抵抗' || n === '異常狀態擊中') {
                    v = v * 100;
                }
            }

            let e = getEntry(k);

            // 累加數值到對應板塊
            if (b.boardName.includes("奈薩肯")) e.nezakan += v;
            else if (b.boardName.includes("吉凱爾")) e.zikel += v;
            else if (b.boardName.includes("白傑爾")) e.baizel += v;
            else if (b.boardName.includes("崔妮爾")) e.triniel += v;
            else if (b.boardName.includes("艾瑞爾")) e.ariel += v;
            else if (b.boardName.includes("阿斯佩爾")) e.asphel += v;
            else if (b.boardName.includes("瑪爾庫坦")) e.malkutan += v;
            else {
                e.other += v;
                e.subtotals.gainEffect += v;
                // 📝 添加詳細來源說明 (僅非主神板塊)
                // 避免重複添加 (如果是重新渲染)
                const detailStr = `[板塊] ${b.boardName}: +${v}${isPerc ? '%' : ''}`;
                if (!e.detailGroups.gainEffect.includes(detailStr)) {
                    e.detailGroups.gainEffect.push(detailStr);
                }
            }
        });

        (b.detail?.openSkillEffectList || []).forEach(sk => {
            let parts = sk.desc.split(' +');
            if (parts.length >= 2) {
                let sn = parts[0].trim(), sv = parts[1].trim();
                boardSkillMap[sn] = (boardSkillMap[sn] || 0) + parseInt(sv);
            }
        });
    });

    (data.title?.titleList || []).forEach(t => {
        if (t.equipCategory) {
            let catName = t.equipCategory === "Attack" ? "⚔️ 攻擊稱號" : (t.equipCategory === "Defense" ? "🛡️ 防禦稱號" : "📘 其他稱號");
            let gradeColor = getGradeColor(t.grade || t.gradeName || t.quality || 'common');

            titleHtml += `<div class="equip-item-card" style="border-color: ${gradeColor}; border-top-color: ${gradeColor}; box-shadow: 0 0 10px ${gradeColor}44; display:block; padding:12px; min-height:auto;">
                        <span class="title-label" style="color:${gradeColor}; border-color:${gradeColor}44;">${catName}</span>
                        <span class="title-val" style="color:${gradeColor}">${t.name}</span>
                        <div class="title-desc">${(t.equipStatList || []).map(ef => `▹ ${ef.desc}`).join('<br>')}</div>
                    </div>`;

            (t.equipStatList || []).forEach(ef => {
                let parts = ef.desc.split(/\s*\+/);
                if (parts.length < 2) return;
                let n = parts[0].trim(), vS = parts[1].trim();
                let k = normalizeKey(n, vS.includes('%'));
                let v = parseFloat(vS.replace('%', ''));

                // 🚨 修正稱號數值縮放 (1000 = 1% vs 100 = 1%)
                const titleScale1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const titleScale100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];

                if (titleScale1000.some(tk => n.includes(tk)) && Math.abs(v) >= 40) {
                    v = v / 1000;
                } else if (titleScale100.some(tk => n.includes(tk)) && Math.abs(v) >= 20) {
                    v = v / 100;
                }

                let e = getEntry(k);
                e.other += v;
                e.subtotals.title += v;
                e.detailGroups.title.push(`[${t.name}]: +${vS}`);

                // 🌟 同步更新到 GAIN_EFFECT_DATABASE 以便屬性展開面板能查找到
                if (!GAIN_EFFECT_DATABASE['稱號']) {
                    GAIN_EFFECT_DATABASE['稱號'] = { active: true, breakdowns: {} };
                }
                const bd = GAIN_EFFECT_DATABASE['稱號'].breakdowns;
                if (!bd[k]) bd[k] = [];
                const detailStr = `[${t.name}]: +${vS}`;
                if (!bd[k].includes(detailStr)) bd[k].push(detailStr);
            });
        }
    });
    document.getElementById('title-grid').innerHTML = titleHtml || "<div style='color:#8b949e; padding:10px;'>未裝備稱號</div>";

    // 處理寵物與翅膀
    let petwingHtml = "";
    if (data.petwing) {
        // 處理寵物
        if (data.petwing.pet) {
            const pet = data.petwing.pet;
            const petName = pet.name || "暫無";
            const petLevel = pet.level ? `Lv.${pet.level}` : "暫無";
            const petIcon = pet.icon ? getCorrectIcon(pet.icon) : "";

            const petGradeColor = getGradeColor(pet.grade || 'legend');

            // 品質翻譯
            const gradeTranslation = {
                'Myth': '神話', 'Unique': '唯一', 'Legend': '傳說', 'Epic': '史詩', 'Rare': '稀有', 'Ancient': '古代'
            };
            const petGrade = pet.grade ? (gradeTranslation[pet.grade] || pet.grade) : "";

            petwingHtml += `<div class="equip-item-card" style="border-color: ${petGradeColor}; border-top-color: ${petGradeColor}; box-shadow: 0 0 10px ${petGradeColor}44; display:block; padding:15px; height:100%;">
                        <div class="box-header" style="color:${petGradeColor}; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:10px; padding-bottom:5px;">🐾 寵物：${petName}</div>
                        <div style="display: flex; gap: 12px; align-items: flex-start;">
                            ${petIcon ? `<img src="${petIcon}" style="width: 64px; height: 64px; border-radius: 8px; border: 2px solid ${petGradeColor}; flex-shrink: 0;">` : ''}
                            <div style="flex: 1;">
                                <div style="font-size:12px; color:#8b949e;">等級: ${petLevel}${petGrade ? ` | 品質: ${petGrade}` : ''}</div>
                            </div>
                        </div>
                    </div>`;
        }

        // 處理翅膀
        if (data.petwing.wing) {
            const wing = data.petwing.wing;
            const wingName = wing.name || "暫無";

            // 品質翻譯對應表
            const gradeTranslation = {
                'Myth': '神話', 'Unique': '唯一', 'Legend': '傳說', 'Epic': '史詩', 'Rare': '稀有', 'Ancient': '古代'
            };
            const wingGrade = wing.grade ? (gradeTranslation[wing.grade] || wing.grade) : "暫無";
            const wingEnchant = (wing.enchantLevel !== undefined && wing.enchantLevel !== null) ? `+${wing.enchantLevel}` : "";
            const gradeColor = getGradeColor(wing.grade || 'epic');
            const wingIcon = wing.icon ? getCorrectIcon(wing.icon) : "";

            // 比對資料庫獲取屬性
            let wingBonusHtml = "";
            const enchantLv = wing.enchantLevel || 0;

            // 優先從 wings_data.json 動態取得裝備加成 (含強化等級)
            const jsonEquipStats = getWingEquipStatsFromJson(wingName, enchantLv);

            const applyStats = (statObj, typeLabel) => {
                for (let statName in statObj) {
                    let val = statObj[statName];
                    let absVal = Math.abs(val);
                    let isDecimal = (absVal > 0 && absVal < 1);

                    // 根據關鍵字強制視為百分比 (除了小數判定外)
                    const percentKeywords = ['增幅', '增加', '減少', '率', '耐性'];
                    const matchesKeyword = percentKeywords.some(k => statName.includes(k));

                    if (isDecimal) val = val * 100;

                    // Use normalizeKey to ensure consistency (e.g. 額外迴避 -> 迴避) and correct aggregation
                    let normName = normalizeKey(statName, (isDecimal || matchesKeyword));

                    // 🚨 強制修正：PVE/PVP 大寫統一 (解決 PvE攻擊力 vs PVE攻擊力 分離問題)
                    normName = normName.replace(/PvE/i, 'PVE').replace(/PvP/i, 'PVP');

                    let entry = getEntry(normName);
                    entry.other += val;
                    entry.subtotals.wing += val;

                    const unit = normName.includes('%') ? '%' : '';
                    // 修正格式: 將 [翅膀名稱](類型) 改為 [翅膀名稱 類型]，避免解析時的括號殘留問題
                    entry.detailGroups.wing.push(`[${wingName} ${typeLabel}]: +${parseFloat(val.toFixed(2))}${unit}`);
                    wingBonusHtml += `<div class="random-row"><span>${typeLabel}-${normName}</span><span style="color:#fff;">+${parseFloat(val.toFixed(2))}${unit}</span></div>`;
                }
            };

            if (jsonEquipStats) {
                // ✅ 使用 wings_data.json 動態資料 (含強化等級加成)
                applyStats(jsonEquipStats, `裝備(+${enchantLv})`);
            } else {
                // Fallback: 使用靜態 WING_DATABASE
                let matchedWing = null;
                for (let key in WING_DATABASE) {
                    if (wingName.includes(key)) {
                        matchedWing = WING_DATABASE[key];
                        break;
                    }
                }
                if (matchedWing && matchedWing.equip) {
                    applyStats(matchedWing.equip, "裝備");
                } else {
                    wingBonusHtml = `<div style="font-size:11px; color:#8b949e">⚡ 此翅膀暫無資料庫加成 (僅外型)</div>`;
                }
            }

            petwingHtml += `<div class="equip-item-card" style="border-color: ${gradeColor}; border-top-color: ${gradeColor}; box-shadow: 0 0 10px ${gradeColor}44; display:block; padding:15px; height:100%;">
                        <div class="box-header" style="color:${gradeColor}; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:10px; padding-bottom:5px;">🪽 翅膀：${wingEnchant} ${wingName}</div>
                        <div style="display: flex; gap: 12px; align-items: flex-start;">
                            ${wingIcon ? `<img src="${wingIcon}" style="width: 64px; height: 64px; border-radius: 8px; border: 2px solid ${gradeColor}; flex-shrink: 0;">` : ''}
                            <div style="flex: 1;">
                                <div style="font-size:12px; color:#8b949e; margin-bottom:px;"></div>
                                ${wingBonusHtml}
                            </div>
                        </div>
                    </div>`;

            // 🪽 自動將裝備中的翅膀加入「翅膀收藏」已勾選清單
            const wingCollect = GAIN_EFFECT_DATABASE['翅膀收藏'];
            if (wingCollect) {
                // 在 WING_DATABASE 中找匹配的 key（翅膀名稱可能包含資料庫 key）
                let matchedWingKey = null;
                for (let dbKey in WING_DATABASE) {
                    if (wingName === dbKey || wingName.includes(dbKey) || dbKey.includes(wingName)) {
                        matchedWingKey = dbKey;
                        break;
                    }
                }
                if (matchedWingKey && !wingCollect.selectedWings.includes(matchedWingKey)) {
                    wingCollect.selectedWings.push(matchedWingKey);
                    // 同步儲存到 localStorage
                    localStorage.setItem('ownedWings', JSON.stringify(wingCollect.selectedWings));
                    // 自動啟用翅膀收藏效果（若尚未啟用）
                    if (!wingCollect.active) {
                        wingCollect.active = true;
                        const states = {};
                        Object.keys(GAIN_EFFECT_DATABASE).forEach(k => {
                            states[k] = GAIN_EFFECT_DATABASE[k].active;
                        });
                        localStorage.setItem('gainEffectStates_v1', JSON.stringify(states));
                    }
                }
            }
        }
    }
    document.getElementById('petwing-grid').innerHTML = petwingHtml || "<div style='color:#8b949e; padding:10px;'>無寵物或翅膀資料</div>";

    // --- Apply Gain Effects from Database (New Logic) ---
    Object.keys(GAIN_EFFECT_DATABASE).forEach(effectName => {
        // Skip '翅膀收藏' here because it is handled by the ownedWings loop below
        if (effectName === '翅膀收藏') return;

        const effect = GAIN_EFFECT_DATABASE[effectName];
        // Check active state
        const isActive = (effect.active !== undefined) ? effect.active : effect.default;

        // Set active explicitly for UI sync
        effect.active = isActive;

        if (isActive) {
            for (let statName in effect.stats) {
                let val = effect.stats[statName];

                // 🌟 使用一致的標準化名稱。
                // 🌟 核心修復：使用一致的標準化名稱。
                // 這裡必須極度精確：如果 val 是大數值 (>=100)，它不能被歸類到百分比入口。
                const isValLarge = Math.abs(val) >= 100;
                let key = normalizeKey(statName, isValLarge ? false : null);

                // 修正：守護力對應 PVP防禦力
                if (statName.includes('守護力')) {
                    key = 'PVP防禦力';
                }

                // 修正：生命力增加 對應 生命力增加 (Flat)
                if (statName === '生命力增加' && !statName.includes('%')) {
                    key = '生命力增加';
                }

                // 如果當前正在處理百分比入口，但數據是固定值，則跳過 (反之亦然)
                // 這能徹底解決「數據加進總分但細項沒出現」的幽靈問題
                let entry = getEntry(key);

                let applyVal = val;

                // 🌟 特殊修正：異常狀態抵抗/擊中 強制百分比轉整數
                if ((key === '異常狀態抵抗' || key === '異常狀態擊中') && Math.abs(val) < 1 && Math.abs(val) > 0) {
                    applyVal = val * 100;
                }
                // 如果是百分比數值 (0.07)，轉為整數 (7) 存入 entry.other
                else if (key.includes('%') && Math.abs(val) > 0 && Math.abs(val) < 1) {
                    applyVal = val * 100;
                }

                entry.other += applyVal;
                entry.subtotals.gainEffect += applyVal;

                let unit = key.includes('%') ? '%' : '';
                const displayVal = parseFloat(applyVal.toFixed(2));

                // 特殊處理被動技能的詳細顯示
                let breakdownFound = false;
                if (effectName === '被動技能' && effect.breakdowns) {
                    // 嘗試使用 normalized key 或原始 statName 查找對應的描述
                    const descriptions = effect.breakdowns[key] || effect.breakdowns[statName];

                    if (descriptions && descriptions.length > 0) {
                        breakdownFound = true;
                        descriptions.forEach(desc => {
                            if (!entry.detailGroups.gainEffect.includes(desc)) {
                                entry.detailGroups.gainEffect.push(desc);
                            }
                        });
                    }
                }

                // 如果沒有找到對應的細項描述 (或不是被動技能)，則顯示通用格式
                if (!breakdownFound) {
                    const desc = `[增益] ${effectName}: +${displayVal}${unit}`;
                    if (!entry.detailGroups.gainEffect.includes(desc)) {
                        entry.detailGroups.gainEffect.push(desc);
                    }
                }

            }
        }

    });

    // 處理寵物洞察力 (Pet Insight) - 準備數據供後續使用
    // petInsight 可能在不同層級: json.petInsight 或 json.queryResult.petInsight 或 data.petInsight
    const petInsight = json.petInsight || (json.queryResult ? json.queryResult.petInsight : null) || data.petInsight;

    // 隱藏原本的寵物洞察力 Grid (因為要搬家了)
    const oldPetGrid = document.getElementById('pet-insight-grid');
    if (oldPetGrid) {
        oldPetGrid.style.display = 'none';
        oldPetGrid.innerHTML = '';
    }
    const oldPetHeader = document.getElementById('pet-insight-header');
    if (oldPetHeader) oldPetHeader.style.display = 'none';

    // 準備寵物數據物件
    let petStats = [];
    let totalPets = 0;

    if (petInsight) {
        const insightTypes = [
            { key: 'intellect', name: '知性', color: '#3498db' },
            { key: 'feral', name: '野性', color: '#2ecc71' },
            { key: 'nature', name: '自然', color: '#f1c40f' },
            { key: 'trans', name: '變形', color: '#9b59b6' }
        ];

        petStats = insightTypes.map(t => {
            const d = petInsight[t.key] || { totalInGame: 0 };
            if (d.totalInGame > 0) totalPets += d.totalInGame;
            return { ...t, data: d };
        });
    }

    // 處理持有翅膀的效果（從收藏系統）
    const wingCollectToggle = GAIN_EFFECT_DATABASE['翅膀收藏'];
    if (wingCollectToggle && wingCollectToggle.active) {
        const ownedWings = JSON.parse(localStorage.getItem('ownedWings') || '[]');
        ownedWings.forEach(wingName => {
            const wing = WING_DATABASE[wingName];
            if (wing) {
                // Helper to process both hold and equip stats
                const processWingStats = (statsObj, sourceType) => {
                    if (!statsObj) return;
                    for (let statName in statsObj) {
                        let val = statsObj[statName];
                        let absVal = Math.abs(val);
                        let isDecimal = (absVal > 0 && absVal < 1);

                        // 根據關鍵字強制視為百分比 (除了小數判定外)
                        const percentKeywords = ['增幅', '增加', '減少', '率', '耐性'];
                        const matchesKeyword = percentKeywords.some(k => statName.includes(k));

                        if (isDecimal) val = val * 100;

                        // 🌟 核心修復：使用 normalizeKey 確保屬性名稱一致性 (例如 額外命中 -> 命中)
                        let normName = normalizeKey(statName, (isDecimal || matchesKeyword));

                        // 🚨 強制修正：PVE/PVP 大寫統一
                        normName = normName.replace(/PvE/i, 'PVE').replace(/PvP/i, 'PVP');

                        let entry = getEntry(normName);
                        entry.other += val;
                        entry.subtotals.wingHold += val;

                        const unit = normName.includes('%') ? '%' : '';
                        entry.detailGroups.wingHold.push(`[${wingName} ${sourceType}]: +${parseFloat(val.toFixed(2))}${unit}`);
                    }
                };

                processWingStats(wing.hold, '持有');
                // processWingStats(wing.equip, '裝備'); // 🚩 移除裝備屬性計算，收藏系統應僅計算「持有」加成，避免雙倍加成錯誤
            }
        });
    } // End of wingCollectToggle check



    const equipMap = {};
    let armorBreakCount = 0; // 初始化武器防具突破件數統計
    let accessoryBreakCount = 0; // 初始化飾品突破件數統計
    let sourceStats = {
        armor: { crafted: 0, dungeon: 0, other: 0, total: 0, breakCount: 0, break5Count: 0 },
        accessory: { crafted: 0, dungeon: 0, other: 0, total: 0, breakCount: 0, break5Count: 0 }
    };
    const setCountMap = new Map(); // 用於計算套裝件數

    (data.equipment ? data.equipment.equipmentList : []).forEach(item => { equipMap[item.slotPos] = item; });

    // 🛡️ 去重複：以 slotPos 為 key，確保同一槽位只計算一次
    const seenSlots = new Set();
    let maxBaseAtkSeen = 0;
    let minBaseAtkLinked = 0;
    let bestWeaponName = "";

    const uniqueItemDetails = (data.itemDetails || []).filter(i => {
        const slot = i.slotPos;
        if (seenSlots.has(slot)) return false;
        seenSlots.add(slot);
        return true;
    });

    uniqueItemDetails.forEach(i => {
        const d = i.detail; if (!d) return;
        const slot = i.slotPos;
        const isArmor = (slot >= 1 && slot <= 8) || slot === 21;
        const isAccessory = (slot >= 9 && slot <= 20) || (slot >= 22 && slot <= 40);
        const isArcana = (slot >= 41 && slot <= 46);
        const originalItem = equipMap[slot] || i;
        const finalIcon = getCorrectIcon(originalItem.icon);

        // 統計突破件數
        const exceedLv = originalItem.exceedLevel || 0;
        if (exceedLv > 0) {
            if (isArmor) {
                armorBreakCount++;
                sourceStats.armor.breakCount++;
                if (exceedLv >= 5) sourceStats.armor.break5Count++;
            }
            if (isAccessory) {
                accessoryBreakCount++;
                sourceStats.accessory.breakCount++;
                if (exceedLv >= 5) sourceStats.accessory.break5Count++;
            }
        }

        // 來源統計
        if (isArmor || isAccessory) {
            const srcs = d.sources || [];
            const isCraft = srcs.some(s => s.includes('製作'));
            const isDungeon = srcs.some(s => ['副本', '聖域', '遠征', '塔', '基地'].some(k => s.includes(k)));

            const typeKey = isArmor ? 'armor' : 'accessory';
            if (isCraft) sourceStats[typeKey].crafted++;
            else if (isDungeon) sourceStats[typeKey].dungeon++;
            else sourceStats[typeKey].other++;
            sourceStats[typeKey].total++;
        }

        // 計算套裝件數
        if (d.set) {
            const setName = d.set.name;
            if (!setCountMap.has(setName)) {
                setCountMap.set(setName, { count: 0, bonuses: d.set.bonuses });
            }
            setCountMap.get(setName).count++;
        }

        if (isArcana) {
            const gradeColor = getGradeColor(d.grade || originalItem.grade || d.gradeName || originalItem.gradeName || d.quality || originalItem.quality || 'special');
            let arcanaStatsHtml = (d.mainStats || []).map(ms => `<div class="base-stat-row"><b>${ms.name}</b> <span>+${ms.value}</span></div>`).join('');
            let arcanaSubStatsHtml = (d.subStats || []).map(ss => `<div class="random-row"><span>${ss.name}</span><span style="color:#fff;">+${ss.value}</span></div>`).join('');
            let arcanaSkillsHtml = (d.subSkills || []).map(sk => `<div class="skill-badge-mini" style="border-color:${gradeColor};">${sk.name} Lv.${sk.level}</div>`).join('');

            arcanaGridHtml += `
                    <div class="equip-item-card" style="border-color: ${gradeColor}; border-top-color: ${gradeColor}; box-shadow: 0 0 10px ${gradeColor}44; display: block; padding: 12px; height: auto; min-height: auto;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                            <div class="equip-img-container" style="border-color: ${gradeColor}; width: 44px; height: 44px;">
                                <img src="${getCorrectIcon(originalItem.icon)}" style="width: 100%; height: 100%; object-fit: cover;">
                            </div>
                            <div class="equip-name" style="color:${gradeColor}; font-weight:bold; text-shadow:0 0 5px ${gradeColor}44; font-size:16px;">+${i.enchantLevel} ${d.name}</div>
                        </div>
                        <div style="font-size:14px; margin-bottom:6px; padding-left: 2px;">${arcanaStatsHtml}</div>
                        <div style="font-size:13px; margin-bottom:6px; padding-left: 2px;">${arcanaSubStatsHtml}</div>
                        <div style="font-size:13px; padding-left: 2px;">${arcanaSkillsHtml}</div>
                    </div>`;
            (d.subSkills || []).forEach(sk => { if (!cardSkillMap[sk.name]) cardSkillMap[sk.name] = []; cardSkillMap[sk.name].push({ name: d.name, lv: sk.level }); });
            (d.mainStats || []).forEach(ms => {
                let k = normalizeKey(ms.name, ms.value.toString().includes('%'));
                let e = getEntry(k);
                let val = parseFloat(ms.value);

                // 🚨 修正聖物數值縮放 (1000 = 1% vs 100 = 1%)
                const aSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const aSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                if (k.includes('%') && aSc1000.some(sk => ms.name.includes(sk)) && Math.abs(val) >= 40) {
                    val = val / 1000;
                } else if (k.includes('%') && aSc100.some(sk => ms.name.includes(sk)) && Math.abs(val) >= 20) {
                    val = val / 100;
                }

                e.other += val;
                e.subtotals.arcana += val;
                e.detailGroups.arcana.push(`${d.name}(主): +${ms.value}`);
            });
            (d.subStats || []).forEach(ss => {
                let k = normalizeKey(ss.name, ss.value.toString().includes('%'));
                let e = getEntry(k);
                let val = parseFloat(ss.value.toString().replace('%', ''));

                // 🚨 修正聖物隨機屬性縮放 (1000 = 1% vs 100 = 1%)
                const asSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const asSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                if (k.includes('%') && asSc1000.some(sk => ss.name.includes(sk)) && Math.abs(val) >= 40) {
                    val = val / 1000;
                } else if (k.includes('%') && asSc100.some(sk => ss.name.includes(sk)) && Math.abs(val) >= 20) {
                    val = val / 100;
                }

                e.other += val;
                e.subtotals.arcana += val;
                e.detailGroups.arcana.push(`${d.name}(刻): +${ss.value}`);
            });
        }

        if (isArmor || isAccessory) {
            const rarityInfo = getEquipmentRarityInfo(i);
            let gradeColor = rarityInfo ? rarityInfo.color : getGradeColor(d.grade);

            let exceedBadge = (originalItem.exceedLevel || 0) > 0 ? `<div class="exceed-badge">${originalItem.exceedLevel}</div>` : "";
            let mainStatsD = (d.mainStats || []).map(s => `<div class="base-stat-row"><b>${s.name} ${(parseFloat(s.value) || 0) + (parseFloat(s.extra) || 0)}</b>${(parseFloat(s.extra) > 0) ? ` <span style="color:var(--green);">(+${s.extra})</span>` : ""}</div>`).join('');
            let godStoneHtml = (d.godStoneStat || []).map(gs => {
                let gsColor = getGradeColor(gs.grade);
                return `<div style="margin-top: 5px; border: 1px dashed ${gsColor}; padding: 4px; font-size:13px; border-radius:4px;"><b style="color:${gsColor}">${gs.name}</b><br>${gs.desc}</div>`;
            }).join('');
            let sourcesHtml = (d.sources || []).map(src => `<span style="color:#fff; font-size:12px; margin-left:4px;">[${src}]</span>`).join('');
            let sbRate = d.soulBindRate || originalItem.soulBindRate;
            let soulBindHtml = (sbRate !== undefined) ? `<span style="float:right; color:#bdc3c7;">靈魂刻印 ${sbRate}%</span>` : "";


            // 主能力值區塊（tooltip 格式）
            const mainStatsSectionHtml = (d.mainStats && d.mainStats.length > 0) ? `
                <div class="tooltip-section">
                    <div class="tooltip-section-title">主要能力值</div>
                    ${(d.mainStats).map(s => {
                const extraVal = (s.extra && parseFloat(s.extra) !== 0) ? String(s.extra).replace('+', '') : null;
                const minVal = s.minValue ? parseFloat(s.minValue) : null;
                const baseValNum = parseFloat(s.value) || 0;
                const baseDisplay = (minVal && minVal > 0)
                    ? `<span class="val-base">${minVal}</span><span style="color:#555;"> ~ </span><span class="val-base">${s.value}</span>`
                    : `<span class="val-base">${s.value}</span>`;

                if (baseValNum === 0 && !minVal && extraVal) {
                    return `<div class="stat-row">
                                <span class="stat-label ${s.exceed ? 'val-orange' : ''}">${s.name}</span>
                                <div class="stat-leader"></div>
                                <span class="stat-value ${s.exceed ? 'val-orange' : 'val-bonus'}">+${extraVal}</span>
                            </div>`;
                }

                return `<div class="stat-row">
                            <span class="stat-label ${s.exceed ? 'val-orange' : ''}">${s.name}</span>
                            <div class="stat-leader"></div>
                            <span class="stat-value">
                                ${baseDisplay}
                                ${extraVal ? `<span class="${s.exceed ? 'val-orange' : 'val-bonus'}"> (+${extraVal})</span>` : ''}
                            </span>
                        </div>`;
            }).join('')}
                </div>` : '';


            // 隨機能力值
            const subStatsSectionHtml = (d.subStats && d.subStats.length > 0) ? `
                <div class="tooltip-section">
                    <div class="tooltip-section-title">隨機能力值</div>
                    ${(d.subStats).map(s => `<div class="stat-row">
                        <span class="stat-label val-green">${s.name}</span>
                        <div class="stat-leader"></div>
                        <span class="stat-value val-green">+${s.value}</span>
                    </div>`).join('')}
                </div>` : '';

            // 磨石
            const stoneSectionHtml = (d.magicStoneStat && d.magicStoneStat.length > 0) ? `
                <div class="tooltip-section">
                    <div class="tooltip-section-title">魔石槽位</div>
                    <div class="magic-stone-list">
                        ${(d.magicStoneStat).map(ms => {
                const sColor = getGradeColor(ms.grade || 'common');
                const cleanName = (ms.name || "").split('+')[0].trim();
                const displayVal = (ms.value || "").toString().startsWith('+') ? ms.value : `+${ms.value}`;
                return `<div class="stone-item">
                                <img class="stone-icon" src="${ms.icon || ''}">
                                <div class="stone-text" style="color:${sColor}">${cleanName} ${displayVal}</div>
                            </div>`;
            }).join('')}
                    </div>
                </div>` : '';

            // 神石
            const godStoneSectionHtml = (d.godStoneStat && d.godStoneStat.length > 0) ? `
                <div class="tooltip-section">
                    <div class="tooltip-section-title">神石</div>
                    ${(d.godStoneStat).map(gs => {
                const gsColor = getGradeColor(gs.grade || 'unique');
                return `<div style="border:1px dashed ${gsColor}; padding:8px; font-size:12px; border-radius:6px; background:rgba(0,0,0,0.2); margin-top:5px;">
                            <b style="color:${gsColor}">${gs.name}</b>
                            <div style="color:#adb5bd; margin-top:4px; line-height:1.4;">${gs.desc}</div>
                        </div>`;
            }).join('')}
                </div>` : '';

            // 突破 + 強化文字
            const exceedText = (originalItem.exceedLevel || 0) > 0
                ? `<span style="background:rgba(231,76,60,0.15); border:1px solid rgba(231,76,60,0.4); padding:1px 6px; border-radius:4px; font-size:11px; font-weight:bold; color:#ff7b7b; margin-left:6px;">突破+${originalItem.exceedLevel}</span>` : '';
            const sbText = d.soulBindRate !== undefined
                ? `<span style="color:#8b949e; font-size:11px; margin-left:auto;">靈魂 ${d.soulBindRate}%</span>` : '';

            // 使用 getEquipmentRarityInfo 統一判斷品階（包含名稱關鍵字修正） - 沿用上方 2981 行已宣告過的 rarityInfo
            const rarityKeyToCssClass = { 'mythic': 'myth', 'legendary': 'unique', 'epic': 'legend', 'special': 'special', 'rare': 'rare', 'common': 'common' };
            const detailRarityClass = rarityInfo ? (rarityKeyToCssClass[rarityInfo.rarityKey] || 'common') : 'common';
            // 完整分頁頂部邊框線色直接取自 rarityInfo.color
            const detailBorderColor = rarityInfo ? rarityInfo.color : '#555';

            // 裝備技能
            const itemSkills = [
                ...(d.skills || []),
                ...(d.subSkills || []),
                ...(d.itemSkills || []),
                ...(d.extraSkills || [])
            ];
            const skillsSectionHtml = (itemSkills.length > 0) ? `
                <div class="tooltip-section">
                    <div class="tooltip-section-title">裝備技能</div>
                    ${itemSkills.map(s => {
                const sName = s.name || (typeof window.getSkillName === 'function' ? window.getSkillName(s.id) : s.id);
                return `<div class="stat-row">
                            <span class="stat-label val-bonus">${sName}</span>
                            <div class="stat-leader"></div>
                            <span class="stat-value val-bonus">${s.level ? `Lv.${s.level}` : ''}</span>
                        </div>`;
            }).join('')}
                </div>` : '';

            let exceedLv = originalItem.exceedLevel || d.exceedLevel || 0;
            const exceedLabelHtml = exceedLv > 0 ? `<span class="breakthrough-label">突破 +${exceedLv}</span>` : "";

            let cardHtml = `
            <div class="equip-tooltip-card tooltip-rarity-${detailRarityClass}" onclick="window.handleSlotClick(event, ${slot})" style="cursor:pointer; border-top: 3px solid ${detailBorderColor};">
                <div class="tooltip-header" style="position: relative; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 0;">
                    <div class="tooltip-icon-frame"><img src="${finalIcon}" onerror="this.src='https://questlog.gg/assets/Game/UI/Resource/Texture/Common/Icon/Icon_Default.png'"></div>
                    <div class="tooltip-title-area">
                        <div class="tooltip-name">${originalItem.enchantLevel > 0 ? `+${originalItem.enchantLevel} ` : ''}${d.name}${exceedLabelHtml}</div>
                        <div class="tooltip-sub-info">
                            <span class="tooltip-grade-label" style="color:${gradeColor}">${rarityInfo ? rarityInfo.name : '一般'}</span>
                            ${d.categoryName ? `<span>${d.categoryName}</span>` : ''}
                            <span>Lv.${d.level || 0}${d.levelValue ? ` (+${d.levelValue})` : ''}</span>
                        </div>
                    </div>
                </div>
                <div class="tooltip-body-static" style="padding: 10px 0;">
                    ${mainStatsSectionHtml}
                    ${subStatsSectionHtml}
                    ${skillsSectionHtml}
                    ${stoneSectionHtml}
                    ${godStoneSectionHtml}
                </div>
            </div>`;

            let gradeNameMap = { 'Myth': '神話', 'Unique': '唯一', '傳說': '傳說', 'Epic': '史詩', 'Rare': '稀有', 'Ancient': '古代', 'myth': '神話', 'unique': '唯一', 'legend': '傳說', 'epic': '史詩', 'rare': '稀有', 'ancient': '古代', 'special': '特殊', 'common': '普通' };
            let rawGrade = d.gradeName || originalItem.gradeName || d.grade || originalItem.grade || '';
            // 數字 grade 轉換
            const gradeNumMap = { 51: '神話', 41: '唯一', 31: '傳說', 21: '稀有', 11: '普通' };
            let locGrade = gradeNumMap[parseInt(rawGrade)] || gradeNameMap[rawGrade] || rawGrade || '特殊';
            let cat = d.category || originalItem.category || '';
            let iLv = originalItem.itemLevel || d.itemLevel || 0;
            let elv = originalItem.enchantLevel || 0;
            exceedLv = originalItem.exceedLevel || d.exceedLevel || 0;
            let exceedHtml = exceedLv > 0 ? ` <span style="display:inline-block; background: rgba(231, 76, 60, 0.15); border: 1px solid rgba(231, 76, 60, 0.4); padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #ff7b7b; vertical-align: middle; line-height: 1.2; margin-left: 4px; white-space: nowrap; text-shadow: none; letter-spacing: 0.5px;">突破+${exceedLv}</span>` : "";

            // --- 為簡易小卡建構左右兩欄內容 (V2) ---
            let statsLeftHtml = "";
            let statsRightHtml = "";

            // 1. 左邊：隨機屬性 (白色) + 技能 (白色)
            (d.subStats || []).forEach(s => {
                const excClass = s.exceed ? 'val-exceed' : '';
                statsLeftHtml += `
                    <div class="simple-stat-row random">
                        <span class="simple-stat-label ${excClass}">${s.name}</span>
                        <span class="simple-stat-value ${excClass}">+${s.value}</span>
                    </div>`;
            });
            // 加上裝備內建技能
            (d.subSkills || []).forEach(sk => {
                statsLeftHtml += `
                    <div class="simple-stat-row random">
                        <span class="simple-stat-label">${sk.name}</span>
                        <span class="simple-stat-value">Lv.${sk.level}</span>
                    </div>`;
            });

            // 2. 右邊：磨石屬性 (依品階顯色)
            (d.magicStoneStat || []).forEach(ms => {
                const stoneColor = getGradeColor(ms.grade || 'common');
                statsRightHtml += `
                    <div class="simple-stat-row" style="color: ${stoneColor}">
                        <span class="simple-stat-label" style="color: ${stoneColor}">[磨] ${ms.name}</span>
                        <span class="simple-stat-value" style="color: ${stoneColor}">${ms.value}</span>
                    </div>`;
            });

            let cardSimpleHtml = `
            <div class="equip-item-card-simple-v2" style="--grade-color: ${gradeColor};" onclick="window.handleSlotClick(event, ${slot})">
                <div class="simple-card-header">
                    <div class="simple-card-title">
                        <span class="simple-card-name">${d.name}</span>
                        ${d.level ? `<span style="font-size:11px; color:#8b949e; margin-left:5px;">Lv.${d.level}${d.levelValue ? ` (+${d.levelValue})` : ''}</span>` : ''}
                        <span class="simple-card-enchant"> (+${elv})</span>
                        ${exceedLv > 0 ? `<span class="simple-card-breakthrough">突破+${exceedLv}</span>` : ""}
                    </div>
                </div>
                <div class="simple-card-body">
                    <div class="simple-card-col simple-card-col-left">
                        ${statsLeftHtml || '<div style="color:#555; font-size:12px;">無隨機/技能</div>'}
                    </div>
                    <div class="simple-card-col simple-card-col-right">
                        ${statsRightHtml || '<div style="color:#555; font-size:12px;">無磨石</div>'}
                    </div>
                </div>
                <img class="simple-card-artwork" src="${finalIcon}">
            </div>`;

            if (isArmor) {
                armorHtml += cardHtml;
                armorSimpleHtml += cardSimpleHtml;
            } else {
                accessoryHtml += cardHtml;
                accessorySimpleHtml += cardSimpleHtml;
            }
            // 🔹 已移除此處重複的 normalizeKey，改用上層定義的統一版本，確保屬性分類一致 🔹
            let mainStatAcc = {};

            (d.mainStats || []).forEach(ms => {
                const rawVal = ms.value.toString();
                const name = ms.name;

                // 🔹 核心修正：嚴格拆分 固定值 與 百分比 🔹
                // 範例： "1778(+3%)" -> baseValue=1778, extraPerc=3
                let baseValue = 0;
                let extraPerc = 0;

                if (rawVal.includes('(')) {
                    baseValue = parseFloat(rawVal.split('(')[0]) || 0;
                    let m = rawVal.match(/\(([\+\-]?[\d\.]+)\%\)/);
                    if (m) extraPerc = parseFloat(m[1]);
                } else {
                    baseValue = parseFloat(rawVal.replace('%', '')) || 0;
                }

                // 判斷該數值字串本身是否代表百分比 (例如 "3%")
                let isRawPerc = rawVal.includes('%') && !rawVal.includes('(');

                // 1. 處理基礎固定值 (1778 部分)
                if (baseValue !== 0) {
                    let key = normalizeKey(name, isRawPerc);

                    // 🚨 修正 Aion Classic 特定屬性 1000 = 1% / 100 = 1% 機制
                    const sc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                    const sc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                    if (sc1000.some(sk => name.includes(sk)) && Math.abs(baseValue) >= 40) {
                        baseValue = baseValue / 1000;
                    } else if (sc100.some(sk => name.includes(sk)) && Math.abs(baseValue) >= 20) {
                        baseValue = baseValue / 100;
                    }

                    let e = getEntry(key);
                    e.equipMain += baseValue;

                    if (!mainStatAcc[key]) mainStatAcc[key] = { total: 0, base: 0, enchant: 0, exceed: 0, soul: 0, isPerc: isRawPerc };
                    mainStatAcc[key].total += baseValue;
                    mainStatAcc[key].base += baseValue;
                }

                // 2. 處理括號內的百分比 (+3% 部分)
                if (extraPerc !== 0) {
                    let key = normalizeKey(name, true); // 強制百分比
                    let e = getEntry(key);
                    e.equipMain += extraPerc;

                    if (!mainStatAcc[key]) mainStatAcc[key] = { total: 0, base: 0, enchant: 0, exceed: 0, soul: 0, isPerc: true };
                    mainStatAcc[key].total += extraPerc;
                    mainStatAcc[key].base += extraPerc;


                }

                // 3. 處理額外值 (強化等，通常為固定值)
                let extraVal = parseFloat(ms.extra?.toString().replace('%', '') || 0);
                if (extraVal > 0) {
                    let isEPerc = ms.extra.toString().includes('%');
                    let key = normalizeKey(name, isEPerc);

                    // 🚨 修正額外強化值縮放 (1000 = 1% / 100 = 1%)
                    const eSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                    const eSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                    if (isEPerc && eSc1000.some(sk => name.includes(sk)) && Math.abs(extraVal) >= 40) {
                        extraVal = extraVal / 1000;
                    } else if (isEPerc && eSc100.some(sk => name.includes(sk)) && Math.abs(extraVal) >= 20) {
                        extraVal = extraVal / 100;
                    }

                    let e = getEntry(key);
                    e.equipMain += extraVal;

                    if (!mainStatAcc[key]) mainStatAcc[key] = { total: 0, base: 0, enchant: 0, exceed: 0, soul: 0, isPerc: isEPerc };
                    mainStatAcc[key].total += extraVal;
                    if (ms.exceed) mainStatAcc[key].exceed += extraVal;
                    else mainStatAcc[key].enchant += extraVal;
                }

                // 🌟 新增：最大攻擊力 (value) 與 最小攻擊力 (minValue)
                const isWeapon = (slot === 1 || slot === 2);
                if (isWeapon && ms.id === "WeaponFixingDamage") {
                    const curMax = parseFloat(ms.value) || 0;
                    const curMin = parseFloat(ms.minValue) || 0;
                    if (curMax > maxBaseAtkSeen) {
                        maxBaseAtkSeen = curMax;
                        minBaseAtkLinked = curMin;
                        bestWeaponName = d.name;
                    }
                }
            });

            // 將整合後的單品項數據寫入 detailGroups
            for (let k in mainStatAcc) {
                let info = mainStatAcc[k];
                let parts = [];
                // 僅當有細項時才顯示括號內容
                if (info.base > 0) parts.push(`基+${parseFloat(info.base.toFixed(2))}`);
                if (info.enchant > 0) parts.push(`強+${parseFloat(info.enchant.toFixed(2))}`);
                if (info.exceed > 0) parts.push(`突+${parseFloat(info.exceed.toFixed(2))}`);


                let unit = info.isPerc ? '%' : '';
                let partsStr = parts.length > 1 ? ` (${parts.join(' / ')})` : '';
                let str = `+${i.enchantLevel} ${d.name}: +${parseFloat(info.total.toFixed(2))}${unit}${partsStr}`;

                getEntry(k).detailGroups.base.push(str);
            }
            (d.subStats || []).forEach(ss => {
                if (!ss.value) return;
                let rawVal = ss.value.toString();
                let k = normalizeKey(ss.name, rawVal.includes('%'));
                let v = parseFloat(rawVal.replace('%', '')) || 0;

                // 🛡️ 單化標準化：暴擊傷害增幅 / 傷害增幅 (某些 gear subStats 也需要)
                if ((k.includes('暴擊傷害增幅') || k.includes('傷害增幅')) && Math.abs(v) >= 20) {
                    v = v / 100;
                    rawVal = v + '%';
                }

                let e = getEntry(k);

                // 🚨 修正 Aion Classic 特定屬性 1000 = 1% 機制 (隨機屬性部分)
                const sSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const sSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                if (sSc1000.some(sk => ss.name.includes(sk)) && Math.abs(v) >= 40) {
                    v = v / 1000;
                } else if (sSc100.some(sk => ss.name.includes(sk)) && Math.abs(v) >= 20) {
                    v = v / 100;
                }

                // 💡 核心優化：將「必定出現在裝備上」的副屬性也歸類到「裝備基礎」，並計入 equipMain
                const isBaseLike = k.includes('暴擊傷害增幅') || k.includes('貫穿') || k.includes('傷害增幅') || k.includes('後方');
                if (isBaseLike) {
                    e.equipMain += v;
                    e.detailGroups.base.push(`${d.name}(副): +${rawVal}`);
                } else {
                    e.equipSub += v;
                    e.subtotals.random += v;
                    e.detailGroups.random.push(`${d.name}: +${ss.value}`);
                }

                // 🔹 處理特殊格式 3(+3%)
                let bracketMatch = rawVal.match(/\(([\+\-]?[\d\.]+)\%\)/);
                if (bracketMatch) {
                    let bVal = parseFloat(bracketMatch[1]);
                    let bKey = normalizeKey(ss.name, '%');
                    let eb = getEntry(bKey);
                    eb.equipSub += bVal;
                    eb.subtotals.random += bVal;
                    eb.detailGroups.random.push(`${d.name}(附): +${bVal}%`);
                }
            });
            (d.magicStoneStat || []).forEach(ms => {
                if (!ms.value) return;
                let rawVal = ms.value.toString();
                let k = normalizeKey(ms.name, rawVal.includes('%'));
                let v = parseFloat(rawVal.replace('%', '')) || 0;

                // 🛡️ 數值單位標準化
                const stSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const stSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                if (stSc1000.some(sk => ms.name.includes(sk)) && Math.abs(v) >= 40) {
                    v = v / 1000;
                } else if (stSc100.some(sk => ms.name.includes(sk)) && Math.abs(v) >= 20) {
                    v = v / 100;
                } else if ((k.includes('暴擊傷害增幅') || k.includes('傷害增幅')) && Math.abs(v) >= 20) {
                    // 舊版 100=1% 兼容
                    v = v / 100;
                }

                let e = getEntry(k);
                e.equipSub += v;
                e.subtotals.stone += v;
                e.detailGroups.stone.push(`${d.name}: ${ms.value}`);

                // 🔹 處理特殊格式 3(+3%)
                let bracketMatch = rawVal.match(/\(([\+\-]?[\d\.]+)\%\)/);
                if (bracketMatch) {
                    let bVal = parseFloat(bracketMatch[1]);
                    let bKey = normalizeKey(ms.name, '%');
                    let eb = getEntry(bKey);
                    eb.equipSub += bVal;
                    eb.subtotals.stone += bVal;
                    eb.detailGroups.stone.push(`${d.name}(附): +${bVal}%`);
                }
            });
        }
    });

    // 🌟 在所有裝備掃描完後，將「最強武器」的範圍攻擊力寫入統計 (僅取最大的一把，不累加)
    if (maxBaseAtkSeen > 0) {
        let eMax = getEntry("最大攻擊力");
        eMax.equipMain = maxBaseAtkSeen;
        eMax.detailGroups.base = [`${bestWeaponName}: +${maxBaseAtkSeen}`];

        let eMin = getEntry("最小攻擊力");
        eMin.equipMain = minBaseAtkLinked;
        eMin.detailGroups.base = [`${bestWeaponName}: +${minBaseAtkLinked}`];
    }

    // 渲染套裝效果（在計算完所有件數後）
    setCountMap.forEach((setData, setName) => {
        const actualCount = setData.count;

        // 1. 計算套裝加成數值 (Fix: 確保套裝數值被加入統計)
        setData.bonuses.forEach(b => {
            if (b.degree <= actualCount) {
                b.descriptions.forEach(desc => {
                    // 🆕 強化版解析：支援 "生命力高於70%時，PVE攻擊力增加60" 這種格式
                    // 先嘗試移除條件前綴 (如 "XXX時，")
                    const cleanDesc = desc.replace(/^.+?[時時時時][，,]/, '').trim();
                    // 匹配格式: "屬性名" + (增加|提升|+/空格) + "數值" + (%?)
                    // 這裡不使用 ^$，因為描述結尾可能有 [冷卻時間] 等括號
                    const match = cleanDesc.match(/^(.+?)\s*(?:增加|提升|\s*\+|\s)\s*([\d\.]+)\s*(%?)/);
                    if (match) {
                        const rawName = match[1].trim();
                        const val = parseFloat(match[2]);
                        const isPerc = match[3] === '%';

                        // 使用上層定義的 normalizeKey 確保 key 的一致性
                        const key = normalizeKey(rawName, isPerc ? val + '%' : val);

                        const e = getEntry(key);
                        e.other += val;
                        e.subtotals.set = (e.subtotals.set || 0) + val;
                        if (!e.detailGroups.set) e.detailGroups.set = [];
                        e.detailGroups.set.push(`[${setName} ${b.degree}件]: +${val}${isPerc ? '%' : ''}`);
                    }
                });
            }
        });

        // 2. 生成顯示 HTML
        setBonusGridHtml += `<div class="info-box"><div class="box-header">🔱 套裝：${setName}</div>${setData.bonuses.map(b => {
            const isActivated = b.degree <= actualCount;
            const checkmark = isActivated ? '✓ ' : '';
            const opacity = isActivated ? '1' : '0.5';
            return `<div style="margin-bottom:8px; padding-left:10px; border-left:2px solid var(--blue); opacity:${opacity}"><span style="color:var(--blue); font-weight:bold;">${checkmark}[${b.degree}件效果]</span><br><span style="color:#e6edf3; font-size:12px;">${b.descriptions.join('、')}</span></div>`;
        }).join('')}</div>`;
    });

    // 更新主標題的突破徽章
    const totalBreakCount = armorBreakCount + accessoryBreakCount;
    const totalBreak5Count = sourceStats.armor.break5Count + sourceStats.accessory.break5Count;

    const breakBadge = document.getElementById('equipment-break-badge');
    const break5Badge = document.getElementById('equipment-break5-badge');

    if (breakBadge) {
        if (totalBreakCount > 0) {
            breakBadge.textContent = `💎 ${totalBreakCount}件突破`;
            breakBadge.style.display = 'inline-block';
        } else {
            breakBadge.style.display = 'none';
        }
    }

    if (break5Badge) {
        if (totalBreak5Count > 0) {
            break5Badge.textContent = `⭐ ${totalBreak5Count}件+5`;
            break5Badge.style.display = 'inline-block';
        } else {
            break5Badge.style.display = 'none';
        }
    }

    // 更新突破件數到標題 (武器防具)
    const armorHeader = document.getElementById('armor-header');
    if (armorHeader) {
        let headerHtml = `武器與防具`;
        if (armorBreakCount > 0) {
            headerHtml += ` <span style="background:rgba(83, 81, 80, 0.2); color:#00d4ff; padding:4px 10px; border-radius:4px; font-size:13px; font-weight:bold; margin-left:8px;">💎 ${armorBreakCount}件突破</span>`;
        }
        if (sourceStats.armor.break5Count > 0) {
            headerHtml += ` <span style="background:rgba(255, 0, 13, 0.2); color:#ffd700; padding:4px 10px; border-radius:4px; font-size:13px; font-weight:bold; margin-left:4px;">⭐ ${sourceStats.armor.break5Count}件突五</span>`;
        }
        armorHeader.innerHTML = headerHtml;
    }

    // 更新突破件數到標題 (飾品配件)
    const accessoryHeader = document.getElementById('accessory-header');
    if (accessoryHeader) {
        let headerHtml = `飾品與配件`;
        if (accessoryBreakCount > 0) {
            headerHtml += ` <span style="background:rgba(83, 81, 80, 0.2); color:#3498db; padding:4px 10px; border-radius:4px; font-size:13px; font-weight:bold; margin-left:8px;">💎 ${accessoryBreakCount}件突破</span>`;
        }
        if (sourceStats.accessory.break5Count > 0) {
            headerHtml += ` <span style="background:rgba(255, 0, 13, 0.2); color:#f1c40f; padding:4px 10px; border-radius:4px; font-size:13px; font-weight:bold; margin-left:4px;">⭐ ${sourceStats.accessory.break5Count}件突五</span>`;
        }
        accessoryHeader.innerHTML = headerHtml;
    }

    document.getElementById('equip-armor-list').innerHTML = armorHtml || "<div>無資料</div>";
    document.getElementById('equip-accessory-list').innerHTML = accessoryHtml || "<div>無資料</div>";
    document.getElementById('equip-armor-list-simple').innerHTML = armorSimpleHtml || "<div>無資料</div>";
    document.getElementById('equip-accessory-list-simple').innerHTML = accessorySimpleHtml || "<div>無資料</div>";

    // ✅ NEW: Render the visual layout tab
    if (typeof window.renderLayoutTab === 'function') {
        window.renderLayoutTab(json);
    }


    // 生成來源分析 HTML (改為橫向堆疊長條圖)
    // 生成來源分析 HTML (改為橫向堆疊長條圖)
    const generateSourceCard = (title, count, stats, color) => {
        if (count === 0) return `<div class="info-box" style="border-left:3px solid ${color}; padding:10px; color:#8b949e; font-size:13px;">${title}: 無數據</div>`;

        const craftedPct = Math.round((stats.crafted / count) * 100);
        const dungeonPct = Math.round((stats.dungeon / count) * 100);
        const otherPct = 100 - craftedPct - dungeonPct; // 確保總和 100%

        return `
                <div style="background:rgba(255,255,255,0.03); border-radius:6px; padding:10px; border:1px solid rgba(255,255,255,0.05); margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="color:${color}; font-weight:bold; font-size:14px;">${title}</span>
                            ${stats.breakCount > 0 ? `<span style="background:rgba(52, 152, 219, 0.2); color:#3498db; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold;">💎 ${stats.breakCount}件突破</span>` : ''}
                            ${stats.break5Count > 0 ? `<span style="background:rgba(241, 196, 15, 0.2); color:#f1c40f; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold;">⭐ ${stats.break5Count}件+5</span>` : ''}
                        </div>
                        <span style="font-size:12px; color:#8b949e;">共 ${count} 件</span>
                    </div>
                    
                    <!-- 進度條容器 -->
                    <div style="height:12px; width:100%; background:rgba(0,0,0,0.4); border-radius:6px; overflow:hidden; display:flex; margin-bottom:8px;">
                        ${craftedPct > 0 ? `<div style="width:${craftedPct}%; background:#e67e22; height:100%;" title="手作: ${stats.crafted}件 (${craftedPct}%)"></div>` : ''}
                        ${dungeonPct > 0 ? `<div style="width:${dungeonPct}%; background:#3498db; height:100%;" title="副本: ${stats.dungeon}件 (${dungeonPct}%)"></div>` : ''}
                        ${otherPct > 0 ? `<div style="width:${otherPct}%; background:#7f8c8d; height:100%;" title="任務: ${stats.other}件 (${otherPct}%)"></div>` : ''}
                    </div>

                    <!-- 數值標示 -->
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#bdc3c7;">
                        <span style="color:#e67e22;">⚒️ 手作 ${stats.crafted}件 (${craftedPct}%)</span>
                        <span style="color:#3498db;">🏰 副本 ${stats.dungeon}件 (${dungeonPct}%)</span>
                        <span style="color:#7f8c8d;">📜 任務 ${stats.other}件 (${otherPct}%)</span>
                    </div>
                </div>`;
    };

    // 生成寵物洞察力橫向條圖
    const generatePetBar = () => {
        if (petStats.length === 0) return `<div style="padding:10px; color:#8b949e;">無寵物數據</div>`;

        let html = `<div style="margin-top:10px;">`;

        petStats.forEach(p => {
            const d = p.data;
            if (d.totalInGame === 0) return;

            const title = p.name;
            const total = d.totalInGame;
            const lv4 = d.atLeastLv4MaxCount || 0;
            const lv3Total = d.atLeastLv3Count || 0;
            const lv3Only = Math.max(0, lv3Total - lv4);
            const others = Math.max(0, total - lv3Total);

            // 計算百分比
            const p4 = Math.round((lv4 / total) * 100);
            const p3 = Math.round((lv3Only / total) * 100);
            const pOther = 100 - p4 - p3;

            html += `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                            <span style="color:${p.color}; font-weight:bold;">${title}</span>
                            <span style="color:#8b949e;">${total} 隻</span>
                        </div>
                        <div style="height:10px; width:100%; background:rgba(0,0,0,0.4); border-radius:5px; overflow:hidden; display:flex;">
                            ${p4 > 0 ? `<div style="width:${p4}%; background:${p.color}; height:100%; box-shadow:0 0 5px ${p.color};" title="Lv4: ${lv4} (${p4}%)"></div>` : ''}
                            ${p3 > 0 ? `<div style="width:${p3}%; background:${p.color}; opacity:0.6; height:100%;" title="Lv3: ${lv3Only} (${p3}%)"></div>` : ''}
                            ${pOther > 0 ? `<div style="width:${pOther}%; background:#4a5568; height:100%;" title="未達標: ${others} (${pOther}%)"></div>` : ''}
                        </div>
                        <div style="display:flex; justify-content:end; gap:10px; margin-top:2px; font-size:10px; color:#8b949e;">
                            <span>💎 L4: ${lv4}</span>
                            <span>✨ L3+: ${lv3Total}</span>
                        </div>
                    </div>
                    `;
        });
        html += `</div>`;
        return html;
    }

    // 最後一次性更新 grid 內容以防止重排
    document.getElementById('arcana-grid').innerHTML = arcanaGridHtml || "";
    document.getElementById('set-bonus-grid').innerHTML = setBonusGridHtml || "";



    // 🆕 計算角色實力綜合評分
    // 準備評分所需的數據
    // 準備評分所需的數據
    // 修正: 根據使用者提供的 API 結構，目標是 daevanionBoardList 陣列
    // 嘗試從多個可能路徑獲取 (直接在 data 下，或在 board/divinityBoard 下)
    const boardData = data.daevanionBoardList ||
        (data.daevanionBoard ? data.daevanionBoard.daevanionBoardList : null) ||
        (data.board ? data.board.daevanionBoardList : null) ||
        (data.divinityBoard ? data.divinityBoard.daevanionBoardList : null) ||
        data.board ||
        [];
    const petInsightData = petInsight; // 寵物洞察力數據
    // 嘗試從多個來源獲取烙印技能數據
    const hasItems = (list) => list && (Array.isArray(list) ? list.length > 0 : (typeof list === 'object' ? Object.keys(list).length > 0 : false));

    let stigmaList = [];
    let pot_stigma1 = data.skill ? (Array.isArray(data.skill) ? data.skill : data.skill.skillList) : null;
    let pot_stigma2 = data.skills ? (Array.isArray(data.skills) ? data.skills : data.skills.skillList) : null;
    let pot_stigma3 = data.stigma || data.stigmaList || data.specialSkill || data.abyssSkill || [];

    if (hasItems(pot_stigma1)) stigmaList = pot_stigma1;
    else if (hasItems(pot_stigma2)) stigmaList = pot_stigma2;
    else stigmaList = pot_stigma3;


    // 如果是在 equipment 下
    if (!hasItems(stigmaList) && data.equipment && data.equipment.stigmaList) {
        stigmaList = data.equipment.stigmaList;
    }
    // 部分 API 可能回傳 object 而非 array
    if (typeof stigmaList === 'object' && !Array.isArray(stigmaList)) {
        stigmaList = Object.values(stigmaList);
    }

    console.log("DEBUG: Original data.skill:", data.skill);
    console.log("DEBUG: Original data.stigmaList:", data.stigmaList);

    // 如果從全體技能抓來的，要先主動過濾掉非烙印技能
    if (Array.isArray(stigmaList)) {
        stigmaList = stigmaList.filter(s => s.category !== 'Active' && s.category !== 'Passive');
    }

    console.log("DEBUG: Final stigmaList for scoring:", stigmaList);

    const skillData = { stigma: stigmaList }; // 技能烙印數據
    const titleData = data.title || {}; // 稱號數據

    const scoreResult = calculateEquipmentScore(
        data.itemDetails || [],
        boardData,
        petInsightData,
        skillData,
        titleData
    );

    // 儲存評分結果供雷達圖使用
    window.currentEquipmentScore = scoreResult;

    // 生成評分卡片 HTML (分頁設計)
    const gradeColor = getScoreGradeColor(scoreResult.grade);

    const scoreCardHtml = `
            <div class="info-box" style="border-top: 3px solid ${gradeColor}; padding: 0; margin-bottom: 10px; overflow: hidden;">
                
                <!-- 分頁按鈕列 -->
                <div style="display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2);">
                    <button id="btn-tab-score-1" class="score-tab-btn" onclick="switchScoreTab('tab-score-1')" style="flex: 1; padding: 10px 2px; border: none; background: transparent; color: var(--gold); border-bottom: 2px solid var(--gold); cursor: pointer; font-weight: bold; font-size: 12px; white-space: nowrap;"> 綜合評分</button>
                    <button id="btn-tab-score-2" class="score-tab-btn" onclick="switchScoreTab('tab-score-2')" style="flex: 1; padding: 10px 2px; border: none; background: transparent; color: #8b949e; border-bottom: 2px solid transparent; cursor: pointer; font-weight: bold; font-size: 12px; white-space: nowrap;"> 計算明細</button>
                    <button id="btn-tab-score-3" class="score-tab-btn" onclick="switchScoreTab('tab-score-3-new')" style="flex: 1; padding: 10px 2px; border: none; background: transparent; color: #8b949e; border-bottom: 2px solid transparent; cursor: pointer; font-weight: bold; font-size: 12px; white-space: nowrap;"> 健檢分析</button>
                </div>

                <!-- 分頁 1: 個人裝備成型度 (保持原樣，僅替換列表) -->
                <div id="tab-score-1" class="score-tab-content" style="padding: 10px;">
                    <div style="text-align: center; margin-bottom: 15px;">
                        <!-- 增強型角色 ID 顯示 -->
                        <div style="margin-bottom: 12px; display: flex; flex-direction: column; align-items: center; gap: 5px;">
                            <div style="font-size: 24px; font-weight: 800; letter-spacing: 1px; line-height: 1.2;">
                                <span style="background: linear-gradient(180deg, #ffffff 0%, #ffd93d 40%, #ffbb00 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 10px rgba(255, 217, 61, 0.4));">
                                    ${data.profile.characterName}
                                </span>
                            </div>
                           
                        </div>
                        <!-- 保持原有大分數顯示 -->
                        <div style="display: flex; align-items: center; justify-content: center; gap: 15px;">
                            <div style="font-size: 52px; font-weight: bold; color: ${gradeColor}; text-shadow: 0 0 20px ${gradeColor}; line-height: 1;">
                                ${scoreResult.totalScore}
                            </div>
                            <span style="background: ${gradeColor}22; border: 2px solid ${gradeColor}; color: ${gradeColor}; padding: 6px 20px; border-radius: 20px; font-size: 16px; font-weight: bold; text-shadow: 0 0 10px ${gradeColor}; display: inline-block;">
                                ${scoreResult.grade} 級
                            </span>
                        </div>
                    </div>
                    
                    <!-- 保持原有進度條 -->
                    <div style="background: rgba(0,0,0,0.3); border-radius: 10px; height: 24px; overflow: hidden; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.05); position: relative;">
                        <div style="background: linear-gradient(90deg, ${gradeColor}, ${gradeColor}aa); height: 100%; width: ${scoreResult.percentage}%; transition: width 0.5s ease; position: absolute; top: 0; left: 0;"></div>
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: #fff; text-shadow: 0 0 2px rgba(0,0,0,0.8); z-index: 2;">
                            達標率 ${scoreResult.percentage}%
                        </div>
                    </div>
                    
                    <!-- 保持原有雷達圖 -->
                    <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 12px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.05); width: 100%;">
                        <div style="text-align: center; margin-bottom: 10px; color: var(--gold); font-size: 14px; font-weight: bold;">📊 能力分佈雷達圖</div>
                        <div style="max-height: 350px; display:flex; justify-content:center; width: 100%;">
                            <canvas id="radarChart" style="max-width: 100%; height: auto !important;"></canvas>
                        </div>
                    </div>

                    <!-- 替換原本的項目列表為新設計的「指標彙整表」 -->
                    <div style="background: rgba(255,217,61,0.08); border: 1px solid rgba(255,217,61,0.2); border-radius: 12px; padding: 10px; margin-bottom: 10px; width: 100%;">
                        <div style="color: #ffd93d; font-weight: bold; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                            <span>📊 各項指標彙整 (目前/參考/權重)</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 11px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px; color: #8b949e;">
                            <div style="text-align: left;">判定指標</div>
                            <div>數值小計</div>
                            <div>參考總計</div>
                            <div>最終權重</div>
                        </div>
                        
                        <!-- 項目行 -->
                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 12px; text-align: center; align-items: center; margin-bottom: 7px;">
                            <div style="text-align: left; color: #ff6b35; font-weight: bold;">🔥 裝備強度</div>
                            <div style="color: #fff;">${scoreResult.breakdown.rarity.rawScore.toFixed(1)}</div>
                            <div style="color: #8b949e;">540</div>
                            <div style="color: #ff6b35; font-weight: bold; background: rgba(255,107,53,0.1); border-radius: 4px; padding: 1px 0;">${scoreResult.breakdown.rarity.score} / 30</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 12px; text-align: center; align-items: center; margin-bottom: 7px;">
                            <div style="text-align: left; color: #3498db; font-weight: bold;">📋 板塊完成</div>
                            <div style="color: #fff;">${scoreResult.breakdown.board.rawScore}</div>
                            <div style="color: #8b949e;">${scoreResult.breakdown.board.maxRawScore}</div>
                            <div style="color: #3498db; font-weight: bold; background: rgba(52,152,219,0.1); border-radius: 4px; padding: 1px 0;">${scoreResult.breakdown.board.score} / 15</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 12px; text-align: center; align-items: center; margin-bottom: 7px;">
                            <div style="text-align: left; color: #2ecc71; font-weight: bold;">🐾 寵物探險</div>
                            <div style="color: #fff;">${scoreResult.breakdown.petInsight.totalClean.toFixed(1)}</div>
                            <div style="color: #8b949e;">8</div>
                            <div style="color: #2ecc71; font-weight: bold; background: rgba(46,204,113,0.1); border-radius: 4px; padding: 1px 0;">${scoreResult.breakdown.petInsight.score} / 20</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 12px; text-align: center; align-items: center; margin-bottom: 7px;">
                            <div style="text-align: left; color: #f39c12; font-weight: bold;">⚔️ 技能烙印</div>
                            <div style="color: #fff;">${scoreResult.breakdown.stigma.rawScore}</div>
                            <div style="color: #8b949e;">1200</div>
                            <div style="color: #f39c12; font-weight: bold; background: rgba(243,156,18,0.1); border-radius: 4px; padding: 1px 0;">${scoreResult.breakdown.stigma.score} / 30</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 4px; font-size: 12px; text-align: center; align-items: center;">
                            <div style="text-align: left; color: #9b59b6; font-weight: bold;">🏅 稱號收集</div>
                            <div style="color: #fff;">${scoreResult.breakdown.title.ownedCount}</div>
                            <div style="color: #8b949e;">${scoreResult.breakdown.title.maxRawScore}</div>
                            <div style="color: #9b59b6; font-weight: bold; background: rgba(155,89,182,0.1); border-radius: 4px; padding: 1px 0;">${scoreResult.breakdown.title.score} / 5</div>
                        </div>
                    </div>
                </div>

                <!-- 分頁 2: 計算明細 -->
                <div id="tab-score-2" class="score-tab-content" style="display: none; padding: 15px;">
                    <!-- 1. 裝備來源分析 (橫向長條) -->
                    <div style="margin-bottom: 20px;">
                        <div style="color:#ffd93d; font-weight:bold; margin-bottom:10px; font-size:14px;">📊 裝備來源結構</div>
                        ${generateSourceCard('⚔️ 武器/防具', sourceStats.armor.total, sourceStats.armor, '#3498db')}
                        ${generateSourceCard('💍 飾品/配件', sourceStats.accessory.total, sourceStats.accessory, '#9b59b6')}
                    </div>

                    <!-- 2. 寵物洞察力分析 (橫向長條) -->
                    <div style="margin-bottom: 20px;">
                        <div style="color:#00d4ff; font-weight:bold; margin-bottom:10px; font-size:14px; display:flex; justify-content:space-between;">
                            <span>🧠 寵物洞察力結構</span>
                            <span style="font-size:11px; font-weight:normal; color:#8b949e;">共 ${totalPets} 隻</span>
                        </div>
                        ${generatePetBar()}
                    </div>
                    
                    <!-- 評分標準說明 (可展開) -->
                    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                        <div onclick="const content = this.nextElementSibling; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; this.querySelector('.toggle-arrow').textContent = isHidden ? '▲' : '▼';" 
                             style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 5px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 8px;">
                            <span style="font-size: 14px; color: #ffd93d; font-weight: bold;">📋 評分標準說明</span>
                            <span class="toggle-arrow" style="color: #ffd93d; font-size: 10px;">▼</span>
                        </div>
                        <div style="display: none; overflow: hidden;">
                            <div style="font-size: 13px; color: #bdc3c7; line-height: 1.6; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                                
                                <!-- 總分說明 -->
                                <!-- 總分制度 -->
                                <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,215,61,0.1); border-left: 3px solid #ffd93d; border-radius: 3px;">
                                    <div style="color: #ffd93d; font-weight: bold; margin-bottom: 4px; font-size: 14px;">📊 總分制度：100分制</div>
                                </div>
                                    <div style="font-size: 12px; color: #eee;">各項目分數加總後，根據權重評定等級。</div>
                               

                                
                                <!-- 分數佔比說明 -->
                                <div style="margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 12px;">
                                    
                                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                        <span style="background: rgba(231,76,60,0.2); color: #e74c3c; padding: 3px 8px; border-radius: 4px; font-weight: bold; border: 1px solid rgba(231,76,60,0.3);">裝備 30%</span>
                                        <span style="background: rgba(52,152,219,0.2); color: #3498db; padding: 3px 8px; border-radius: 4px; font-weight: bold; border: 1px solid rgba(52,152,219,0.3);">板塊 15%</span>
                                        <span style="background: rgba(46,204,113,0.2); color: #2ecc71; padding: 3px 8px; border-radius: 4px; font-weight: bold; border: 1px solid rgba(46,204,113,0.3);">寵物 20%</span><br>
                                        <span style="background: rgba(243,156,18,0.2); color: #f39c12; padding: 3px 8px; border-radius: 4px; font-weight: bold; border: 1px solid rgba(243,156,18,0.3);">技能 30%</span>
                                        <span style="background: rgba(155,89,182,0.2); color: #9b59b6; padding: 3px 8px; border-radius: 4px; font-weight: bold; border: 1px solid rgba(155,89,182,0.3);">稱號 5%</span>
                                    </div>
                                </div>
                            
                                <!-- 裝備品階 -->
                                <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                    <div style="background: rgba(231,76,60,0.15); color: #ffccbc; padding: 8px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; font-size: 14px; border-left: 4px solid #e74c3c;">🔥 裝備強度 (30%)</div>
                                    <div style="padding-left: 8px; font-size: 12px; color: #bdc3c7; line-height: 1.5;">
                                        <div style="margin-bottom: 4px;">• <b>核心概念：</b>計算全身裝備的綜合強度，強化等級影響最大。</div>
                                        <div style="margin-bottom: 4px;">• <b>基礎分：</b><span style="color:#aaa;">神話(10) > 傳說(7) > 史詩(4.5) > 特殊(2.5)</span></div>
                                        <div style="margin-bottom: 4px;">• <b>加成分：</b>強化/突破等級越高分數翻倍；閃耀額外加分。</div>
                                        <b>🎯 目標：</b>全身目標強度約 540 分 (含飾品上限)
                                        
                                    </div>
                                </div>

                                <!-- 板塊 -->
                                <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                    <div style="background: rgba(52,152,219,0.15); color: #AED6F1; padding: 8px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; font-size: 14px; border-left: 4px solid #3498db;">📋 板塊數量 (15%)</div>
                                    <div style="padding-left: 8px; font-size: 12px; color: #bdc3c7; line-height: 1.5;">
                                        <div style="margin-bottom: 4px;">• <b>計算方式：</b>依據板塊取得難度進行加權。</div>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: #aaa; font-size: 11px; margin-top: 2px;"></div>
                                            <div style="margin-bottom: 4px;">• <b>基礎四塊板塊（各）</b>: 1.5分</div>                                            
                                            <div style="margin-bottom: 4px;">• <b>艾瑞爾權重為</b>: 2.0分</div>
                                            <div style="margin-bottom: 4px;">• <b>阿斯佩爾權重為</b>: 4.0分</div>
                                            <div style="margin-bottom: 4px;">• <b>瑪爾庫坦權重為</b>: 3.0分</div>
                                        
                                    </div>
                                </div>

                                <!-- 寵物數量 -->
                                <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                    <div style="background: rgba(46,204,113,0.15); color: #A9DFBF; padding: 8px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; font-size: 14px; border-left: 4px solid #2ecc71;">🐾 寵物數量 (20%)</div>
                                    <div style="padding-left: 8px; font-size: 12px; color: #bdc3c7; line-height: 1.5;">
                                        <div style="margin-bottom: 4px;">• <b>計算方式：</b>依據 4 大類別的 L3/L4 達成比例計算。</div>
                                        <div style="margin-bottom: 4px;">• <b>本區無法計算寵物理解度.僅計算寵物數量拿滿.</div>
                                        <div style="color: #aaa; font-size: 11px;">(lv3=1分,lv4=2分,4種lv4以上=8分滿分)</div>
                                    <br>

                                </div>

                                <!-- 技能烙印 -->
                                <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                    <div style="background: rgba(243,156,18,0.15); color: #F9E79F; padding: 8px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; font-size: 14px; border-left: 4px solid #f39c12;">⚔️ 技能烙印 (30%)</div>
                                    <div style="padding-left: 8px; font-size: 12px; color: #bdc3c7; line-height: 1.5;">
                                        <div style="margin-bottom: 4px;">• <b>核心階段：</b>達成 4 個核心 Lv20，即獲得 <b style="color:#eee;">24分 (80%)</b>。</div>
                                        <div>• <b>極限階段 (400點以上)：</b>超出部分緩步增加，直到滿分。</div>
                                    </div>
                                </div>

                                <!-- 稱號 -->
                                <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                    <div style="background: rgba(155,89,182,0.15); color: #D7BDE2; padding: 8px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; font-size: 14px; border-left: 4px solid #9b59b6;">🏅 稱號數量 (5%)</div>
                                    <div style="padding-left: 8px; font-size: 12px; color: #bdc3c7; line-height: 1.5;">
                                        <div style="margin-bottom: 4px;">• <b>核心階段：</b>收集總數 50%，即獲得 <b style="color:#eee;">4分 (80%)</b>。</div>
                                        <div>• <b>極限階段：</b>剩餘 1 分隨數量增加直到拿滿。</div>
                                    </div>
                                </div>

                                <!-- 評級標準 -->
                                <div style="margin-top: 8px;">
                                    <div style="color: #ffd93d; font-weight: bold; margin-bottom: 4px; font-size: 14px;">🏆 評級標準 (百分比)</div>
                                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center; font-size: 11px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                        <span style="color: #ef9a9a; font-weight:bold;">SSS > 90%</span>
                                        <span style="color: #ffcc80; font-weight:bold;">SS > 80%</span>
                                        <span style="color: #fff59d; font-weight:bold;">S > 70%</span>
                                        <span style="color: #bdc3c7;">A > 60%</span>
                                        <span style="color: #bdc3c7;">B > 50%</span>
                                        <span style="color: #bdc3c7;">C > 40%</span>
                                        <span style="color: #90a4ae;">D > 30%</span>
                                        <span style="color: #78909c;">E < 30%</span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <!-- 詳細資料來源 (可展開) -->
                    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                        <div onclick="const content = this.nextElementSibling; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; this.querySelector('.toggle-arrow').textContent = isHidden ? '▲' : '▼';" 
                             style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 5px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 8px;">
                            <span style="font-size: 14px; color: #ffd93d; font-weight: bold;">📊 詳細資料來源</span>
                            <span class="toggle-arrow" style="color: #ffd93d; font-size: 10px;">▼</span>
                        </div>
                        <div style="display: none; overflow: hidden;">
                            <div style="font-size: 11px; color: #bdc3c7; line-height: 1.6; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; max-height: 400px; overflow-y: auto;">
                                
                                <!-- 裝備詳情 -->
                                <div style="color: #ffd93d; font-weight:bold; margin-bottom: 8px;">🔥 裝備品階詳情</div>
                                ${(scoreResult.breakdown.rarity.details || []).map(d => `
                                    <div style="background: rgba(255,255,255,0.05); border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; border-left: 4px solid ${d.color || '#fff'}; display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <div style="color: ${d.color || '#fff'}; font-weight:bold; font-size:12px;">${d.name} <span style="font-size: 10px; opacity:0.7; font-weight:normal;">${d.dragonType}</span></div>
                                            <div style="font-size: 10px; color: #8b949e;">
                                                基礎:${d.baseScore} | 
                                                <span style="color: #3498db;">強化(+${d.pureEnchantLevel}):+${d.enchantBonus}</span>
                                                ${d.exceedLevel > 0 ? ` | <span style="color: #e74c3c;">突破(+${d.exceedLevel}):+${d.exceedBonus}</span>` : ''}
                                                ${d.shineBonus > 0 ? ` | <span style="color: #f1c40f;">閃耀:+${d.shineBonus}</span>` : ''}
                                            </div>
                                        </div>
                                            <div style="text-align:right;">
                                                <div style="color: var(--gold); font-weight: bold;">+${d.score}</div>
                                                <div style="font-size: 9px; color: #8b949e; margin-top:2px;">
                                                    (約 ${(d.score * 30 / 540).toFixed(1)}分)
                                                </div>
                                            </div>
                                        </div>
                                    `).join('')}
                                    ${(!scoreResult.breakdown.rarity.details || scoreResult.breakdown.rarity.details.length === 0) ? '<div style="color: #7f8c8d; font-style: italic;">無相關裝備</div>' : ''}
                                    
                                    <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <span style="font-size: 14px;">🔥</span>
                                            <span style="color: #bdc3c7; font-size: 11px;">裝備合計</span>
                                        </div>
                                        <div style="text-align: right;">
                                            <span style="color: #ffd93d; font-weight: bold; font-size: 13px;">${scoreResult.breakdown.rarity.rawScore.toFixed(1)} 強度</span>
                                            <span style="color: #ff6b35; font-size: 12px; margin-left: 6px; font-weight: bold;">➡ ${scoreResult.breakdown.rarity.score} / 30 分</span>
                                        </div>
                                    </div>


                                <!-- 板塊 -->
                                <div style="color: #ffd93d; font-weight:bold; margin: 15px 0 8px 0;">📋 德巴板塊完成數</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                    ${(scoreResult.breakdown.board.details || []).map(d => `
                                        <div style="background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px; border-left: 4px solid ${d.weight > 3 ? '#e74c3c' : '#3498db'};">
                                            <div style="color: #fff; font-size: 12px; margin-bottom: 2px; display:flex; justify-content:space-between;">
                                                <span>${d.name}</span>
                                                <span style="color:${d.weight > 3 ? '#e74c3c' : '#bdc3c7'}; font-size:10px;">(權重:${d.weight})</span>
                                            </div>
                                            <div style="display: flex; justify-content: space-between; align-items: flex-end;">
                                                <div>
                                                    <span style="font-size: 14px; font-weight: bold; color: #3498db;">${d.count}</span>
                                                    <span style="font-size: 10px; color: #8b949e;">/ ${d.max}</span>
                                                </div>
                                                <div style="color: var(--gold); font-weight:bold; font-size:12px;">+${d.score}分</div>
                                            </div>
                                        </div>
                                    `).join('') || '<div style="color: #7f8c8d;">無板塊數據</div>'}
                                </div>
                                <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="font-size: 14px;">📋</span>
                                        <span style="color: #bdc3c7; font-size: 11px;">板塊合計</span>
                                    </div>
                                    <div style="text-align: right;">
                                        <span style="color: #ffd93d; font-weight: bold; font-size: 13px;">${scoreResult.breakdown.board.rawScore} 個板塊</span>
                                        <span style="color: #3498db; font-size: 12px; margin-left: 6px; font-weight: bold;">➡ ${scoreResult.breakdown.board.score} / 15 分</span>
                                    </div>
                                </div>

                                <!-- 寵物 -->
                                <div style="color: #ffd93d; font-weight:bold; margin: 15px 0 8px 0;">🐾 寵物探險隊 (3/4階佔比)</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                ${(scoreResult.breakdown.petInsight.details || []).map(d => {
        let pColor = d.lv4 > 0 ? '#e74c3c' : (d.lv3 > 0 ? '#f1c40f' : '#2ecc71');
        return `
                                    <div style="background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px; border-left: 4px solid ${pColor};">
                                        <div style="color: #fff; font-size: 12px; margin-bottom: 2px;">${d.type === 'intellect' ? '智慧' : (d.type === 'feral' ? '野性' : (d.type === 'nature' ? '自然' : '變身'))}</div>
                                        <div style="font-size: 11px; color: #ccc;">
                                            <span style="color:${d.lv4 > 0 ? '#e74c3c' : '#888'}">L4:${d.lv4}</span> | 
                                            <span style="color:${d.lv3 > 0 ? '#f1c40f' : '#888'}">L3:${d.lv3}</span>
                                        </div>
                                        <div style="font-size:10px; color:#8b949e; text-align:right; margin-top:2px;">(貢獻 ${d.rawScore || 0} 點)</div>
                                    </div>
                                `}).join('') || '<div style="color: #7f8c8d;">無寵物數據</div>'}
                                </div>
                                <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="font-size: 14px;">🐾</span>
                                        <span style="color: #bdc3c7; font-size: 11px;">寵物合計</span>
                                    </div>
                                    <div style="text-align: right;">
                                        <span style="color: #ffd93d; font-weight: bold; font-size: 13px;">${scoreResult.breakdown.petInsight.totalClean.toFixed(1)} 階</span>
                                        <span style="color: #2ecc71; font-size: 12px; margin-left: 6px; font-weight: bold;">➡ ${scoreResult.breakdown.petInsight.score} / 20 分</span>
                                    </div>
                                </div>

                                <!-- 技能 -->
                                <div style="color: #ffd93d; font-weight:bold; margin: 15px 0 8px 0;">⚔ 技能烙印 (特化權重)</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                                ${(scoreResult.breakdown.stigma.details || []).slice(0, 12).map(d => {
            // 顏色邏輯: 高分紅, 中分橘, 低分藍
            let sColor = '#3498db';
            if (d.level >= 15) sColor = '#e74c3c';
            else if (d.level >= 10) sColor = '#e67e22'; // Orange
            else if (d.level >= 5) sColor = '#f1c40f'; // Yellow

            return `
                                    <div style="background: rgba(255,255,255,0.05); border-radius: 4px; padding: 6px; border-left: 3px solid ${sColor}; text-align:center;">
                                        <div style="color: #fff; font-size: 11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${d.name}">${d.name}</div>
                                        <div style="color: ${sColor}; font-weight: bold; font-size: 13px;">Lv.${d.level} <span style="font-size:10px; color:#aaa;">(${d.points}分)</span></div>
                                    </div>
                                `}).join('') || '<div style="color: #7f8c8d;">無技能數據</div>'}
                                </div>
                                <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="font-size: 14px;">⚔️</span>
                                        <span style="color: #bdc3c7; font-size: 11px;">技能合計</span>
                                    </div>
                                    <div style="text-align: right;">
                                        <span style="color: #ffd93d; font-weight: bold; font-size: 13px;">${scoreResult.breakdown.stigma.rawScore} 強度</span>
                                        <span style="color: #f39c12; font-size: 12px; margin-left: 6px; font-weight: bold;">➡ ${scoreResult.breakdown.stigma.score} / 30 分</span>
                                    </div>
                                </div>

                                <!-- 稱號 -->
                                <div style="color: #ffd93d; font-weight:bold; margin: 15px 0 8px 0;">🏅 稱號收集</div>
                                <div style="background: rgba(255,255,255,0.05); border-radius: 4px; padding: 10px; border-left: 4px solid #9b59b6; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <div>
                                        <div style="font-size: 12px; color: #ccc;">擁有數量</div>
                                        <div style="font-size: 16px; font-weight: bold; color: #fff;">${scoreResult.breakdown.title.ownedCount} <span style="font-size:12px; font-weight:normal; color:#888;">/ ${scoreResult.breakdown.title.totalCount}</span></div>
                                    </div>
                                    <div style="text-align: right; font-size: 10px; color: #8b949e; line-height: 1.4;">
                                        50% 得 4 分<br>100% 得 5 分
                                    </div>
                                </div>
                                <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="font-size: 14px;">🏅</span>
                                        <span style="color: #bdc3c7; font-size: 11px;">稱號合計</span>
                                    </div>
                                    <div style="text-align: right;">
                                        <span style="color: #ffd93d; font-weight: bold; font-size: 13px;">${scoreResult.breakdown.title.ownedCount} 個稱號</span>
                                        <span style="color: #9b59b6; font-size: 12px; margin-left: 6px; font-weight: bold;">➡ ${scoreResult.breakdown.title.score} / 5 分</span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                </div>

            </div>`;

    let sourceAnalysisHtml = scoreCardHtml;

    // 插入 HTML 到頁面 (專屬容器)
    if (!statsOnly) {
        const equipSourceGridInject = document.getElementById('equip-source-grid');
        if (equipSourceGridInject) {
            // 1. 注入 Tab 1 & Tab 2 (可能含有結構錯誤)
            equipSourceGridInject.innerHTML = sourceAnalysisHtml;

            // 2. [FIX] 動態創建並附加 Tab 3 (確保它獨立於前面的 HTML 結構)
            const tab3Div = document.createElement('div');
            tab3Div.id = 'tab-score-3-new';
            tab3Div.className = 'score-tab-content';
            tab3Div.style.display = 'none';
            tab3Div.style.padding = '20px';
            tab3Div.innerHTML = `
                        <div id="health-check-container" style="min-height: 200px;">
                            <div style="text-align: center; padding: 40px; color: #8b949e;">
                                <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
                                <div>正在分析機體數據...</div>
                            </div>
                        </div>
                    `;
            equipSourceGridInject.appendChild(tab3Div);

            // 3. 獨立渲染健檢分析 UI (增加 try-catch 防止崩潰)
            setTimeout(() => {
                try {
                    if (typeof renderHealthCheckUI === 'function' && scoreResult && scoreResult.analysis) {
                        renderHealthCheckUI(scoreResult.analysis);
                    }
                } catch (e) {
                    console.error("HealthCheck rendering failed:", e);
                    const hc = document.getElementById('health-check-container');
                    if (hc) hc.innerHTML = '<div style="color:#666; padding:20px;">分析模組載入失敗</div>';
                }
            }, 50);

            // 4. 立即渲染雷達圖
            setTimeout(() => { if (typeof renderRadarChart === 'function') renderRadarChart(); }, 100);
        }
    }



    // 渲染新圖表 (已改為 CSS 渲染，移除 Chart.js 相關代碼)
    // if (sourceStats.armor.total > 0) window.srcArmorChart = drawSourcePie('chart-source-armor', sourceStats.armor);
    // if (sourceStats.accessory.total > 0) window.srcAccessoryChart = drawSourcePie('chart-source-accessory', sourceStats.accessory);
    renderSkills(data, boardSkillMap, cardSkillMap, { getEntry });



    // --- 渲染重新設計的主要能力值概覽 (列表收合式) ---
    const overviewGrid = document.getElementById('stat-main-grid');
    if (overviewGrid) {
        // 強制切換容器類名以適應新 CSS
        overviewGrid.className = 'stat-list-container';

        const extraConfig = [
            {
                name: "攻擊力", icon: "⚔️",
                bases: ["攻擊力"], extras: ["額外攻擊力"], percs: ["攻擊力增加"], fixeds: ["PVE攻擊力", "首領攻擊力"]
            },
            {
                name: "攻擊力增加", icon: "📈",
                bases: [], extras: [], percs: ["攻擊力增加"], fixeds: []
            },
            {
                name: "防禦力", icon: "🛡️",
                bases: ["防禦力"], extras: ["額外防禦力"], percs: ["防禦力增加"], fixeds: ["PVE防禦力", "PVE傷害耐性", "首領防禦力", "首領傷害耐性"]
            },

            {
                name: "防禦力增加", icon: "🛡️",
                bases: [], extras: [], percs: ["防禦力增加"], fixeds: []
            },
            {
                name: "生命力", icon: "❤️",
                bases: ["生命力"], extras: [], percs: ["生命力增加"], fixeds: []
            },

            {
                name: "精神力", icon: "💧",
                bases: ["精神力"], extras: ["額外精神力"], percs: ["精神力增加"], fixeds: []
            },


            {
                name: "暴擊", icon: "💥",
                bases: ["暴擊"], extras: [], percs: ["暴擊增加"], fixeds: []
            },
            {
                name: "暴擊傷害增幅", icon: "🔥",
                bases: ["暴擊傷害增幅"], extras: [], percs: [], fixeds: []
            },
            {
                name: "命中", icon: "🎯",
                bases: ["命中"], extras: ["額外命中"], percs: ["命中增加"], fixeds: ["PVE命中"]
            },
            {
                name: "傷害增幅", icon: "⚡",
                bases: ["傷害增幅"], extras: [], percs: [], fixeds: ["PVE傷害增幅", "首領傷害增幅"]
            },
            { name: "武器傷害增幅", keys: ["武器傷害增幅"], icon: "🗡️" },
            { name: "後方傷害增幅", keys: ["後方傷害增幅"], icon: "👤" },
            { name: "強擊", keys: ["強擊"], icon: "👊" },
            { name: "多段打擊擊中", keys: ["多段打擊擊中"], icon: "🔄" },
            { name: "異常狀態擊中", keys: ["異常狀態擊中"], icon: "📊" },
            { name: "異常狀態抵抗", keys: ["異常狀態抵抗"], icon: "🛡️" },
            { name: "戰鬥速度", keys: ["戰鬥速度"], icon: "👟" },
            { name: "冷卻時間", keys: ["冷卻時間", "冷卻時間減少"], icon: "⏳" }
        ];

        const parseOverviewDesc = (str) => {
            if (!str) return "基礎能力值";
            const valMatch = str.match(/[\+\-]?[\d\.]+%?/);
            const val = valMatch ? valMatch[0] : "";
            const name = str.replace(val, '').replace(/增加|物理|魔法|屬性|\s/g, '').trim();
            return name + (val && !val.startsWith('+') && !val.startsWith('-') ? ' +' : ' ') + val;
        };

        // 定義分頁與行切換函數 (若尚未定義)
        if (!window.switchStatTab) {
            window.switchStatTab = (el, tabId) => {
                const container = el.closest('.stat-list-container');
                container.querySelectorAll('.stat-tab-btn').forEach(b => b.classList.remove('active'));
                container.querySelectorAll('.stat-tab-content').forEach(c => c.classList.remove('active'));
                el.classList.add('active');
                container.querySelector(`#${tabId}`).classList.add('active');
            };
        }

        if (!window.toggleRowExpand) {
            window.toggleRowExpand = (el) => {
                el.classList.toggle('expanded');
            };
        }

        // 每次渲染前重置排除統計的「已重置」旗標，確保能正確清空
        const _pveBossFlag = GAIN_EFFECT_DATABASE['排除PVE與首領'];
        const _boardFlag = GAIN_EFFECT_DATABASE['排除守護力'];
        if (_pveBossFlag) _pveBossFlag.__resetDone = false;
        if (_boardFlag) _boardFlag.__resetDone = false;

        // 🔍 狀態保存：記錄目前概覽分頁的展開項目
        const expandedLabels = new Set();
        overviewGrid.querySelectorAll('.stat-list-row.expanded').forEach(row => {
            const label = row.querySelector('.stat-row-label');
            if (label) expandedLabels.add(label.textContent.trim());
        });

        let overviewHtml = `
                    <div class="stat-tabs-header">
                        <div class="stat-tab-btn active" onclick="switchStatTab(this, 'stat-tab-extra')">戰力指標</div>
                        <div class="stat-tab-btn" onclick="switchStatTab(this, 'stat-tab-core')">屬性</div>
                        <div class="stat-tab-btn" onclick="switchStatTab(this, 'stat-tab-boards')">守護板塊</div>
                        <div class="stat-tab-btn" onclick="switchStatTab(this, 'stat-tab-passive')">被動技能</div>
                    </div>


                    <div id="stat-tab-extra" class="stat-tab-content active">
                        <div class="stat-general-grid">
                            ${(window.__PINNED_STAT_VALUES__ = [], extraConfig).map(cfg => {
            // 提取屬性值的輔助函數
            const getSumOf = (keyList, searchType = 'any', forceContext = null) => {
                let sum = 0;
                let items = [];
                let allDetails = [];

                const alwaysPercKeys = ['戰鬥速度', '移動速度', '攻擊速度', '飛行速度', '暴擊傷害增幅', '冷卻時間', '傷害增幅', '傷害耐性', '武器傷害增幅', '後方傷害增幅', '強擊', '多段打擊', '完美', '再生', '鐵壁', '擊中', '抵抗', '耐性'];


                (keyList || []).forEach(searchKey => {
                    Object.keys(stats).forEach(statKey => {
                        const e = stats[statKey];
                        const cleanK = statKey.replace('%', '').trim();
                        // 🔍 智慧判定：不只依賴 % 字元，也檢查屬性名是否屬百分比清單
                        const isInherentlyPerc = alwaysPercKeys.some(k => cleanK.includes(k));
                        const isPercKey = statKey.includes('%') || e.isPerc || isInherentlyPerc;

                        let matchFound = false;
                        const possibleNames = [searchKey, '物理' + searchKey, '魔法' + searchKey, '屬性' + searchKey];
                        if (possibleNames.includes(cleanK)) matchFound = true;

                        if (!matchFound) return;

                        // 💡 修正：如果屬性屬於百分比類，則跳過嚴苛的 searchType 過濾，確保 9 + 32.4% 會被加總
                        if (!isInherentlyPerc) {
                            if (searchType === 'flat' && isPercKey) return;
                            if (searchType === 'perc' && !isPercKey) return;
                        }

                        const rawBoardVal = (e.nezakan || 0) + (e.zikel || 0) + (e.baizel || 0) + (e.triniel || 0) + (e.malkutan || 0) + (e.ariel || 0) + (e.asphel || 0);

                        // 紀錄排除明細
                        if (window.isExcludeBoardStats()) {
                            const boardFlag = GAIN_EFFECT_DATABASE['排除守護力'];
                            if (boardFlag) {
                                if (!boardFlag.__resetDone) {
                                    boardFlag._excludedStats = {};
                                    boardFlag.__resetDone = true;
                                }

                                const boardNamesMap = {
                                    nezakan: '奈薩肯', zikel: '吉凱爾', baizel: '白傑爾',
                                    triniel: '崔妮爾', malkutan: '瑪爾庫坦', ariel: '艾瑞爾', asphel: '阿斯佩爾'
                                };

                                Object.entries(boardNamesMap).forEach(([field, name]) => {
                                    const v = e[field] || 0;
                                    if (Math.abs(v) > 0.001) {
                                        const label = `${statKey.replace('%', '')} [${name}板塊]`;
                                        boardFlag._excludedStats[label] = (boardFlag._excludedStats[label] || 0) + v;
                                    }
                                });
                            }
                        }

                        const boardVal = window.isExcludeBoardStats() ? 0 : rawBoardVal;
                        const wingVal = (e.subtotals?.wing || 0) + (e.subtotals?.wingHold || 0);
                        const setVal = (e.subtotals?.set || 0);
                        const equipVal = (e.equipMain || 0) + wingVal + setVal;
                        const stoneVal = (e.equipSub || 0);
                        const otherVal = (e.other || 0) - wingVal - setVal;
                        let valRaw = boardVal + equipVal + stoneVal + otherVal;
                        let val = valRaw;

                        // 🚨 修正 Aion Classic 特定屬性 1000 = 1% / 100 = 1% 機制 (Overview 縮放)
                        const oSc1000 = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                        const oSc100 = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];

                        let isScaled = false;
                        if (isPercKey && oSc1000.some(sk => statKey.includes(sk)) && Math.abs(val) >= 40) {
                            val = val / 1000;
                            isScaled = true;
                        } else if (isPercKey && oSc100.some(sk => statKey.includes(sk)) && Math.abs(val) >= 20) {
                            val = val / 100;
                            isScaled = true;
                        }

                        if (Math.abs(val) > 0.001) {
                            sum += val;
                            items.push({
                                key: statKey.replace('%', ''), // 移除 Key 中冗餘的 % 以利顯示
                                val: val,
                                valRaw: valRaw,
                                isScaled: isScaled,
                                isPerc: isPercKey,
                                sources: { board: boardVal, equip: equipVal, stone: stoneVal, other: otherVal }
                            });

                            if (e.detailGroups) {
                                ['base', 'skill', 'gainEffect', 'title', 'wing', 'wingHold', 'set', 'arcana', 'stone', 'random', 'mainStat', 'etc'].forEach(g => {
                                    if (e.detailGroups[g] && e.detailGroups[g].length > 0) {
                                        let filteredDetails = e.detailGroups[g];

                                        // 🛡️ 如果開啟「排除守護力」，過濾掉名稱含「守護力」或「板塊」的明細
                                        if (window.isExcludeBoardStats()) {
                                            filteredDetails = filteredDetails.filter(d =>
                                                !d.includes('守護力') && !d.includes('板塊')
                                            );
                                        }

                                        // ⚔️ 如果開啟「排除PVE與首領」，過濾掉名稱含 PVE 或 首領 的明細
                                        if (window.isExcludePveBoss()) {
                                            filteredDetails = filteredDetails.filter(d =>
                                                !PVE_BOSS_PREFIXES.some(p => d.includes(p))
                                            );
                                        }

                                        allDetails.push(...filteredDetails);
                                    }
                                });
                            }
                        }
                    }); // Closes Object.keys(stats).forEach(statKey => { ... });
                }); // Closes (keyList || []).forEach(searchKey => { ... });
                return { total: sum, items: items, details: allDetails };
            };


            const formatSourceLabel = (s) => {
                let tags = [];
                /* 
                // 原本是用來顯示 (板塊:+xx 基礎:+xx) 的細項，使用者要求隱藏
                if (Math.abs(s.board) > 0.1) tags.push(`板塊:+${s.board.toFixed(0)}`);
                if (Math.abs(s.equip) > 0.1) tags.push(`基礎/強化:+${s.equip.toFixed(0)}`);
                if (Math.abs(s.stone) > 0.1) tags.push(`磨石/隨機:+${s.stone.toFixed(0)}`);
                if (Math.abs(s.other) > 0.1) tags.push(`稱號/被動/聖物:+${s.other.toFixed(0)}`);
                return tags.length > 0 ? ` <span style="opacity:0.6; font-size:10px; color:#aaa;">(${tags.join(' ')})</span>` : "";
                */
                return "";
            };

            let totalVal = 0;
            let isPerc = false;
            let breakdownHtml = "";
            let gatheredDetails = [];

            if (cfg.bases) {
                // 複合計算模式
                const baseRes = getSumOf(cfg.bases, 'flat');
                const extraRes = getSumOf(cfg.extras, 'flat');
                const percRes = getSumOf(cfg.percs, 'perc');
                // 🛡️ 排除PVE與首領旗標：過濾 fixeds 中的 PVE/首領 key
                const flagItem = GAIN_EFFECT_DATABASE['排除PVE與首領'];
                if (window.isExcludePveBoss() && flagItem) {
                    // 只在第一個 cfg 時清空（避免每次 cfg 都重置）
                    if (!flagItem.__resetDone) { flagItem._excludedStats = {}; flagItem.__resetDone = true; }
                    const excludedKeys = (cfg.fixeds || []).filter(k => PVE_BOSS_PREFIXES.some(p => k.startsWith(p)));
                    const excludedRes = getSumOf(excludedKeys, 'flat');
                    excludedRes.items.forEach(item => {
                        const label = `${cfg.name} - ${item.key}`;
                        flagItem._excludedStats[label] = (flagItem._excludedStats[label] || 0) + item.val;
                    });
                }
                const effectiveFixeds = window.isExcludePveBoss()
                    ? (cfg.fixeds || []).filter(k => !PVE_BOSS_PREFIXES.some(p => k.startsWith(p)))
                    : cfg.fixeds;
                const fixedRes = getSumOf(effectiveFixeds, 'flat');


                gatheredDetails = [...baseRes.details, ...extraRes.details, ...percRes.details, ...fixedRes.details];

                const multiplier = 1 + (percRes.total / 100);

                // 特殊邏輯：如果是純百分比增加類屬性 (主要用於顯示「攻擊力增加%」本身)
                if (baseRes.total === 0 && extraRes.total === 0 && percRes.total !== 0) {
                    totalVal = percRes.total;
                    isPerc = true;
                } else {
                    totalVal = (baseRes.total + extraRes.total) * multiplier + fixedRes.total;
                    isPerc = cfg.name.includes('%') || baseRes.items.some(i => i.isPerc);
                }

                // 建立明細 (複合模式)
                if (baseRes.total !== 0) breakdownHtml += `<div>基礎: ${baseRes.total.toFixed(0)} ${baseRes.items.map(i => formatSourceLabel(i.sources)).join('')}</div>`;
                if (extraRes.total !== 0) breakdownHtml += `<div>額外: ${extraRes.total.toFixed(0)} ${extraRes.items.map(i => formatSourceLabel(i.sources)).join('')}</div>`;
                if (percRes.total !== 0) breakdownHtml += `<div>加成: ${percRes.total.toFixed(1)}% ${percRes.items.map(i => formatSourceLabel(i.sources)).join('')}</div>`;
                if (fixedRes.total !== 0) breakdownHtml += `<div>固定/PVE: ${fixedRes.total.toFixed(0)} ${fixedRes.items.map(i => formatSourceLabel(i.sources)).join('')}</div>`;
            } else {
                // 一般加總模式
                const res = getSumOf(cfg.keys, cfg.name.includes('%') ? 'perc' : 'flat');
                totalVal = res.total;
                gatheredDetails = res.details;
                isPerc = res.items.some(i => i.isPerc) || cfg.name.includes('%');
                breakdownHtml = res.items.map(i => {
                    let dispVal = i.isScaled ? `+${i.valRaw} (${parseFloat(i.val.toFixed(2))}${i.isPerc ? '%' : ''})` : `+${parseFloat(i.val.toFixed(2))}${i.isPerc ? '%' : ''}`;
                    return `<div>${i.key} ${dispVal}${formatSourceLabel(i.sources)}</div>`;
                }).join('');
            }

            // 去重詳細資訊
            gatheredDetails = [...new Set(gatheredDetails)];

            // 隱藏詳細來源分項 (由使用者要求移除)
            const detailsHtml = "";

            const displayVal = (() => {
                // 特殊邏輯：冷卻時間 (無論正負都視為減少量，並加總顯示為負值)
                if (cfg.name.includes("冷卻")) {
                    // 將所有項目的絕對值相加
                    let absTotal = 0;
                    if (cfg.bases) {
                        // 複合模式下不易處理細項，這裡假設冷卻時間通常走一般模式
                        // 若走複合模式，需遍歷所有 res
                        const baseRes = getSumOf(cfg.bases, 'flat');
                        const extraRes = getSumOf(cfg.extras, 'flat');
                        const percRes = getSumOf(cfg.percs, 'perc');
                        const fixedRes = getSumOf(cfg.fixeds, 'flat');

                        // 簡單策略：直接加總所有 total 的絕對值 (假設沒有混合加減的情境)
                        absTotal = Math.abs(baseRes.total) + Math.abs(extraRes.total) + Math.abs(percRes.total) + Math.abs(fixedRes.total);
                    } else {
                        // 一般模式：遍歷 items 加總絕對值
                        const res = getSumOf(cfg.keys, cfg.name.includes('%') ? 'perc' : 'flat');
                        absTotal = res.items.reduce((acc, item) => acc + Math.abs(item.val), 0);
                    }

                    // 總是顯示為負百分比 (例如 -10.0%)
                    return '-' + absTotal.toFixed(1) + '%';
                }

                return isPerc ? totalVal.toFixed(1) + '%' : Math.floor(totalVal);
            })();
            // 📌 儲存計算結果供釘選預覽使用
            window.__PINNED_STAT_VALUES__.push({ icon: cfg.icon, name: cfg.name, val: displayVal });

            return `
                                    <div class="stat-list-row" onclick="toggleRowExpand(this)">
                                        <div class="stat-row-label">
                                            ${cfg.icon} ${cfg.name}
                                        </div>
                                        <div class="stat-row-val">${displayVal}</div>
                                        <div class="stat-row-desc">
                                            ${breakdownHtml || "<div>無加成數據</div>"}
                                            ${detailsHtml}
                                        </div>
                                    </div>`;
        }).join('')}
                        </div>
                    </div>

                    <div id="stat-tab-core" class="stat-tab-content">
                        <div class="stat-general-grid">
                            ${(coreStatsForOverview || []).map(s => {
            const valNum = parseInt(String(s.value).replace(/,/g, ''), 10);
            const colorStyle = (!isNaN(valNum) && valNum > 200) ? 'color:#ff6b6b !important;' : '';
            return `
                                <div class="stat-list-row" onclick="toggleRowExpand(this)">
                                    <div class="stat-row-label">${s.name}</div>
                                    <div class="stat-row-val" style="${colorStyle}">${s.value}</div>
                                    <div class="stat-row-desc">
                                        ${s.descs.map(d => `<div>${parseOverviewDesc(d)}</div>`).join('') || "<div>基礎屬性</div>"}
                                    </div>
                                    <div class="tooltip"><b>${s.name} 詳細轉換:</b><br>${s.details}</div>
                                </div>`;
        }).join('')}
                        </div>
                    </div>
                    <div id="stat-tab-passive" class="stat-tab-content">
                        <div class="stat-general-grid" style="display:block;">
                            ${window.__PASSIVE_SKILLS_HTML__ || '<div style="color:#8b949e; padding:30px; text-align:center;">⌛ 正在計算職業被動加成...</div>'}
                        </div>
                       
                    </div>
                    <div id="stat-tab-boards" class="stat-tab-content">
                        <div style="padding:10px 0;">
                            ${(() => {
                // 1. 預先計算總覽數據
                const boardData = data.daevanionBoardList || (data.daevanionBoard && data.daevanionBoard.daevanionBoardList) || [];
                let globalOpen = 0, globalTotal = 0;
                boardData.forEach(b => {
                    globalOpen += (b.openNodeCount || b.detail?.openStatEffectList?.length || 0);
                    globalTotal += (b.totalNodeCount || b.detail?.totalStatEffectCount || 38); // 預設 38
                });

                const boardDefs = [
                    { name: '奈薩肯', key: 'nezakan', color: '#e67e22', icon: '🔶' },
                    { name: '吉凱爾', key: 'zikel', color: '#e74c3c', icon: '🔴' },
                    { name: '白傑爾', key: 'baizel', color: '#3498db', icon: '🔵' },
                    { name: '崔妮爾', key: 'triniel', color: '#9b59b6', icon: '🟣' },
                    { name: '瑪爾庫坦', key: 'malkutan', color: '#1abc9c', icon: '🟢' },
                    { name: '艾瑞爾', key: 'ariel', color: '#f1c40f', icon: '🟡' },
                    { name: '阿斯佩爾', key: 'asphel', color: '#e056fd', icon: '🟠' }
                ];

                let boardHtml = `
                                    <div style="background:rgba(255,215,0,0.05); border:1px solid rgba(255,215,0,0.2); border-radius:8px; padding:12px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
                                        <div style="display:flex; align-items:center; gap:8px;">
                                            <span style="font-size:20px;">🛡️</span>
                                            <span style="font-weight:bold; color:var(--gold);">全板塊小計</span>
                                        </div>
                                        <div style="text-align:right;">
                                            <div style="font-size:16px; font-weight:bold; color:#fff;">${globalOpen} <span style="font-size:12px; color:#8b949e;">/ ${globalTotal} 點</span></div>
                                            <div style="font-size:11px; color:#8b949e;">解鎖進度: ${Math.round((globalOpen / (globalTotal || 1)) * 100)}%</div>
                                        </div>
                                    </div>
                                `;
                let anyData = (globalOpen > 0);

                boardDefs.forEach(bd => {
                    const entries = [];
                    Object.keys(stats).forEach(statKey => {
                        const e = stats[statKey];
                        const val = e[bd.key] || 0;
                        if (Math.abs(val) > 0.001) {
                            const isPerc = statKey.includes('%') || e.isPerc;
                            let displayVal = val;
                            let unit = '';
                            if (isPerc) {
                                displayVal = Math.abs(val) < 1 ? Number((val * 100).toFixed(2)) : Math.round(val * 100) / 100;
                                unit = '%';
                            } else {
                                displayVal = Math.round(val * 100) / 100;
                            }
                            entries.push({ key: statKey, val: displayVal, unit });
                        }
                    });

                    // 查找此板塊的節點資訊
                    const boardInfo = boardData.find(b => b.name && (b.name.includes(bd.name) || bd.name.includes(b.name)));
                    const bOpen = boardInfo ? (boardInfo.openNodeCount || boardInfo.detail?.openStatEffectList?.length || 0) : 0;
                    const bTotal = boardInfo ? (boardInfo.totalNodeCount || boardInfo.detail?.totalStatEffectCount || 38) : 0;

                    if (entries.length === 0 && bOpen === 0) return;

                    boardHtml += `
                                        <div style="border:1px solid rgba(255,255,255,0.08); border-radius:8px; margin-bottom:10px; overflow:hidden; background:rgba(0,0,0,0.15);">
                                            <div style="background:${bd.color}22; border-left:4px solid ${bd.color}; padding:8px 12px; display:flex; align-items:center; gap:8px;">
                                                <span style="font-size:14px;">${bd.icon}</span>
                                                <span style="color:${bd.color}; font-weight:bold; font-size:13px;">${bd.name}板塊</span>
                                                <span style="color:#fff; font-size:11px; margin-left:auto; background:rgba(0,0,0,0.3); padding:2px 8px; border-radius:10px;">${bOpen}/${bTotal} 點</span>
                                            </div>
                                            <div style="padding:8px 12px; display:grid; grid-template-columns:1fr 1fr; gap:4px 15px;">
                                                ${entries.length > 0 ? entries.map(en => `
                                                    <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.03);">
                                                        <span style="color:#94a3b8; font-size:11px;">${en.key.replace('%', '')}</span>
                                                        <span style="color:${bd.color}; font-size:12px; font-weight:bold;">+${en.val}${en.unit}</span>
                                                    </div>`).join('') : '<div style="grid-column: span 2; color:#555; font-size:11px; text-align:center; padding:10px;">尚未獲得屬性加成</div>'}
                                            </div>
                                        </div>`;
                });

                // 也顯示「其他」板塊 (非主神板塊，例如活動或特殊板塊)
                const otherEntries = [];
                Object.keys(stats).forEach(statKey => {
                    const e = stats[statKey];
                    if (e.detailGroups && e.detailGroups.gainEffect) {
                        e.detailGroups.gainEffect
                            .filter(d => d.startsWith('[板塊]') && !boardDefs.some(bd => d.includes(bd.name)))
                            .forEach(d => otherEntries.push(d));
                    }
                });
                if (otherEntries.length > 0) {
                    boardHtml += `
                                        <div style="border:1px solid rgba(255,255,255,0.08); border-radius:8px; margin-bottom:10px; overflow:hidden;">
                                            <div style="background:rgba(255,255,255,0.05); border-left:4px solid #8b949e; padding:8px 12px;">
                                                <span style="color:#8b949e; font-weight:bold; font-size:13px;">其他板塊</span>
                                            </div>
                                            <div style="padding:8px 12px;">
                                                ${[...new Set(otherEntries)].map(d => `<div style="color:#8b949e; font-size:11px; padding:2px 0;">${d}</div>`).join('')}
                                            </div>
                                        </div>`;
                }

                return anyData ? boardHtml : '<div style="color:#8b949e; padding:30px; text-align:center;">⌛ 尚未正確抓取到板塊資料，請確認遊戲內已開啟守護力系統</div>';
            })()}
                        </div>
                    </div>
`;

        // ---------------------------

        overviewGrid.innerHTML = overviewHtml;

        // 🔍 狀態還原：遍歷新生成的行，若名稱在記錄中則還原展開狀態
        overviewGrid.querySelectorAll('.stat-list-row').forEach(row => {
            const label = row.querySelector('.stat-row-label');
            if (label && expandedLabels.has(label.textContent.trim())) {
                row.classList.add('expanded');
            }
        });
    }

    renderCombatAnalysis(stats, data);

    // 📌 如果戰力指標已釘選，同步更新釘選面板
    if (window._statsPinned && typeof window._renderPinnedPreview === 'function') {
        window._renderPinnedPreview();
    }
    if (!statsOnly) {
        renderTrendChart(json, 'itemLevel'); // 預設顯示裝備等級
    }

    if (!skipScroll) {
        window.scrollTo({ top: document.getElementById('main-content').offsetTop - 20, behavior: 'smooth' });
    }
} // End of processData


// 歷史趨勢曲線圖 (整合裝備等級與排名)
// 註冊 datalabels 插件
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

let trendChartInstance = null;

const rankingTypeNames = {
    1: '深淵',
    3: '惡夢',
    4: '超越',
    6: '協力競技場',
    20: '討伐戰',
    21: '覺醒戰'
};

function renderTrendChart(json, type = 'itemLevel') {
    const canvas = document.getElementById('trend-chart');
    const infoDiv = document.getElementById('trend-info');

    if (!canvas) return;

    // 銷毀舊圖表
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    if (type === 'itemLevel') {
        // ===== 渲染裝備等級曲線 =====
        let itemLevelHistory = null;
        if (json.itemLevelHistory) {
            itemLevelHistory = json.itemLevelHistory;
        } else if (json.queryResult && json.queryResult.itemLevelHistory) {
            itemLevelHistory = json.queryResult.itemLevelHistory;
        }

        if (!itemLevelHistory || itemLevelHistory.length === 0) {
            if (infoDiv) infoDiv.innerHTML = '⚠️ 無歷史等級資料';
            return;
        }

        // 只取最近 10 次記錄
        const recentHistory = itemLevelHistory.slice(-10);
        const labels = [];
        const itemLevels = [];
        const pointColors = [];

        recentHistory.forEach((record, index) => {
            const date = new Date(record.date);
            labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
            itemLevels.push(record.itemLevel);
            pointColors.push(index === recentHistory.length - 1 ? '#ffd93d' : '#58a6ff');
        });

        // 計算統計資訊
        const currentLevel = recentHistory[recentHistory.length - 1].itemLevel;
        const startLevel = recentHistory[0].itemLevel;
        const maxLevel = Math.max(...itemLevels);
        const totalGrowth = currentLevel - startLevel;
        const growthRate = startLevel > 0 ? ((totalGrowth / startLevel) * 100).toFixed(2) : '0.00';

        // 更新資訊顯示
        if (infoDiv) {
            infoDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-around; flex-wrap: wrap; gap: 15px;">
                            <div><span style="color: var(--gold);">裝分:</span> <b style="color: var(--gold-bright); font-size: 16px;">${currentLevel}</b></div>
                            <div><span style="color: var(--green);">近期成長:</span> <b style="color: var(--green-bright);">${totalGrowth >= 0 ? '+' : ''}${totalGrowth} (${growthRate}%)</b></div>
                            <div><span style="color: var(--blue);">最高紀錄:</span> <b style="color: var(--blue-bright);">${maxLevel}</b></div>
                            <div><span style="color: #8b949e;">近期10筆:</span> <b style="color: #fff;">${recentHistory.length} 次</b></div>
                        </div>
                    `;
        }

        // 繪製圖表
        const ctx = canvas.getContext('2d');
        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '道具等級',
                    data: itemLevels,
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    pointBackgroundColor: pointColors,
                    pointBorderColor: pointColors,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 50,
                        right: 30,
                        bottom: 0,
                        left: 20
                    }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: true,
                        align: function (context) {
                            // 交替上下排列避免重疊
                            return context.dataIndex % 2 === 0 ? 'top' : 'bottom';
                        },
                        anchor: function (context) {
                            return context.dataIndex % 2 === 0 ? 'end' : 'start';
                        },
                        offset: 8,
                        backgroundColor: function (context) {
                            return context.dataIndex === context.dataset.data.length - 1
                                ? 'rgba(255, 217, 61, 0.9)'
                                : 'rgba(88, 166, 255, 0.9)';
                        },
                        borderRadius: 4,
                        color: '#fff',
                        font: {
                            weight: 'bold',
                            size: 12
                        },
                        padding: { top: 4, bottom: 4, left: 6, right: 6 },
                        clamp: true,
                        formatter: function (value) {
                            return value.toLocaleString();
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 20, 25, 0.95)',
                        titleColor: '#ffd93d',
                        bodyColor: '#e6edf3',
                        borderColor: '#2d3748',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                const index = context[0].dataIndex;
                                const record = recentHistory[index];
                                const date = new Date(record.date);
                                return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
                            },
                            label: function (context) {
                                return `道具等級: ${context.parsed.y}`;
                            },
                            afterLabel: function (context) {
                                const index = context[0].dataIndex;
                                const record = recentHistory[index];
                                let info = [`模式: ${record.modelType}`];
                                if (index > 0) {
                                    const prevLevel = recentHistory[index - 1].itemLevel;
                                    const diff = record.itemLevel - prevLevel;
                                    if (diff > 0) info.push(`較前次 +${diff}`);
                                    else if (diff < 0) info.push(`較前次 ${diff}`);
                                    else info.push('無變化');
                                }
                                return info;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: {
                            color: '#e6edf3',
                            font: { size: 14 },
                            callback: function (value) { return value.toLocaleString(); }
                        },
                        title: {
                            display: true,
                            text: '道具等級',
                            color: '#ffd93d',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)', drawBorder: false },
                        ticks: {
                            color: '#e6edf3',
                            font: { size: 13 },
                            maxRotation: 45,
                            minRotation: 45
                        },
                        title: {
                            display: true,
                            text: '日期',
                            color: '#e6edf3',
                            font: { size: 13 }
                        }
                    }
                },
                animation: { duration: 1000, easing: 'easeInOutQuart' }
            }
        });

    } else {
        // ===== 渲染排名曲線 =====
        if (!json || !json.gameRankingHistory) {
            if (infoDiv) infoDiv.innerHTML = '⚠️ 無排名歷史資料';
            return;
        }

        const rankingData = json.gameRankingHistory[type];
        if (!rankingData || !rankingData.history || rankingData.history.length === 0) {
            if (infoDiv) infoDiv.innerHTML = `⚠️ 無${rankingTypeNames[type]}排名歷史資料`;
            return;
        }

        const history = rankingData.history.slice(-5);
        const labels = [];
        const ranks = [];
        const pointColors = [];

        history.forEach((record, index) => {
            const date = new Date(record.date);
            labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
            ranks.push(record.rank);
            pointColors.push(index === history.length - 1 ? '#ffd93d' : '#58a6ff');
        });

        // 計算統計資訊
        const currentRank = ranks[ranks.length - 1];
        const startRank = ranks[0];
        const bestRank = Math.min(...ranks);
        const rankChange = startRank - currentRank;
        const currentScore = history[history.length - 1].score;

        // 更新資訊顯示
        if (infoDiv) {
            const rankChangeText = rankChange > 0
                ? `<span style="color: var(--green-bright);">↑ ${rankChange}</span>`
                : rankChange < 0
                    ? `<span style="color: #f85149;">↓ ${Math.abs(rankChange)}</span>`
                    : '<span style="color: #8b949e;">-</span>';

            infoDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-around; flex-wrap: wrap; gap: 15px;">
                            <div><span style="color: var(--gold);">目前排名:</span> <b style="color: var(--gold-bright); font-size: 16px;">#${currentRank.toLocaleString()}</b></div>
                            <div><span style="color: var(--green);">排名變化:</span> <b>${rankChangeText}</b></div>
                            <div><span style="color: var(--blue);">最佳排名:</span> <b style="color: var(--blue-bright);">#${bestRank.toLocaleString()}</b></div>
                            <div><span style="color: #8b949e;">目前分數:</span> <b style="color: #fff;">${currentScore.toLocaleString()}</b></div>
                        </div>
                    `;
        }

        // 繪製圖表
        const ctx = canvas.getContext('2d');
        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '排名',
                    data: ranks,
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    pointBackgroundColor: pointColors,
                    pointBorderColor: pointColors,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 50,
                        right: 30,
                        bottom: 0,
                        left: 20
                    }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: true,
                        align: 'top',
                        anchor: 'end',
                        backgroundColor: function (context) {
                            return context.dataIndex === context.dataset.data.length - 1
                                ? 'rgba(255, 217, 61, 0.9)'
                                : 'rgba(88, 166, 255, 0.9)';
                        },
                        borderRadius: 4,
                        color: '#fff',
                        font: {
                            weight: 'bold',
                            size: 15
                        },
                        padding: 6,
                        formatter: function (value) {
                            return '#' + value.toLocaleString();
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 20, 25, 0.95)',
                        titleColor: '#ffd93d',
                        bodyColor: '#e6edf3',
                        borderColor: '#2d3748',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                const index = context[0].dataIndex;
                                const record = history[index];
                                const date = new Date(record.date);
                                return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
                            },
                            label: function (context) {
                                return `排名: #${context.parsed.y.toLocaleString()}`;
                            },
                            afterLabel: function (context) {
                                const index = context.dataIndex;
                                const record = history[index];
                                let info = [`分數: ${record.score.toLocaleString()}`];
                                if (index > 0) {
                                    const prevRank = history[index - 1].rank;
                                    const rankDiff = prevRank - record.rank;
                                    if (rankDiff > 0) info.push(`較前次 ↑${rankDiff}`);
                                    else if (rankDiff < 0) info.push(`較前次 ↓${Math.abs(rankDiff)}`);
                                    else info.push('排名無變化');
                                }
                                return info;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        reverse: true, // 排名數字越小越好
                        beginAtZero: false,
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: {
                            color: '#e6edf3',
                            font: { size: 14 },
                            callback: function (value) { return '#' + value.toLocaleString(); }
                        },
                        title: {
                            display: true,
                            text: '排名',
                            color: '#ffd93d',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)', drawBorder: false },
                        ticks: {
                            color: '#e6edf3',
                            font: { size: 13 },
                            maxRotation: 45,
                            minRotation: 45
                        },
                        title: {
                            display: true,
                            text: '日期',
                            color: '#e6edf3',
                            font: { size: 13 }
                        }
                    }
                },
                animation: { duration: 1000, easing: 'easeInOutQuart' }
            }
        });
    }
}

// 設置趨勢曲線切換按鈕事件
document.addEventListener('DOMContentLoaded', function () {
    const trendTabs = document.querySelectorAll('.trend-tab');
    trendTabs.forEach(tab => {
        tab.addEventListener('click', function () {
            // 移除所有 active 狀態
            trendTabs.forEach(t => {
                t.classList.remove('active');
                t.removeAttribute('style'); // 清除可能殘留的 inline style
            });

            // 設置當前按鈕為 active
            this.classList.add('active');

            // 重新渲染圖表
            const trendType = this.getAttribute('data-type');
            if (window.__LAST_DATA_JSON__) {
                renderTrendChart(window.__LAST_DATA_JSON__, trendType);
            }
        });
    });
});


// --- 全域分頁切換函數 (確保分頁功能正常) ---
window.switchScoreTab = function (tabId) {
    // 1. 隱藏所有分頁內容
    document.querySelectorAll('.score-tab-content').forEach(el => {
        el.style.display = 'none';
    });

    // 2. 移除所有按鈕 active 狀態
    document.querySelectorAll('.score-tab-btn').forEach(btn => {
        btn.style.color = '#8b949e';
        btn.style.borderBottom = '2px solid transparent';
    });

    // 3. 顯示目標分頁
    const target = document.getElementById(tabId);
    if (target) {
        target.style.display = 'block';
    } else {
        console.warn(`Target tab not found: ${tabId}`);
    }

    // 4. 設定對應按鈕 active 狀態
    let btn = document.getElementById('btn-' + tabId);
    if (!btn) {
        if (tabId === 'tab-score-3-new') btn = document.getElementById('btn-tab-score-3');
    }

    if (btn) {
        btn.style.color = 'var(--gold)';
        btn.style.borderBottom = '2px solid var(--gold)';
    }
};

// 增益效果渲染

function renderSkills(data, boardSkillMap, cardSkillMap, stats) {
    let act = "", pas = "", sti = "", pasDetailed = "";

    // 🆕 輔助函數:解析技能效果文字並加入統計
    const parseSkillEffect = (effectText, skillName, getEntry) => {
        // 匹配格式: "屬性名稱增加數值" 或 "屬性名稱+數值" (支援百分比)
        const match = effectText.match(/^(.+?)(?:增加|\s*\+)([0-9.]+)(%?)$/);

        // console.log(`[技能解析] 技能: ${skillName}, 效果: "${effectText}", 匹配結果:`, match);

        if (match) {
            let statName = match[1].trim();
            let value = parseFloat(match[2]);
            let isPercent = match[3] === '%';

            // 標準化屬性名稱 - 使用系統中的格式
            // 百分比屬性格式: "屬性名稱增加%" (若原本沒有增加兩字則補上，若有+則去除)
            // 固定值屬性格式: "屬性名稱"

            let key = isPercent ? statName + '增加%' : statName;

            // 修正常見命名差異
            if (key === '敵對值增幅增加%') key = '敵對值增幅%';
            if (key === '最大生命力增加%') key = '生命力增加%';
            if (key === '最大生命力額外增加%') key = '生命力增加%';

            // console.log(`[技能解析] 屬性: ${key}, 數值: ${value}, 百分比: ${isPercent}`);

            // 加入統計
            if (getEntry && typeof getEntry === 'function') {
                try {
                    let entry = getEntry(key);
                    entry.other += value;
                    entry.subtotals.skill = (entry.subtotals.skill || 0) + value;

                    // 添加詳細記錄
                    if (!entry.detailGroups.skill) {
                        entry.detailGroups.skill = [];
                    }
                    entry.detailGroups.skill.push(`<span style="color:var(--gold)">${skillName}</span>: <span style="color:#fff">+${value}${isPercent ? '%' : ''}</span>`);

                    return true;
                } catch (error) {
                    // console.error(`[技能解析] ✗ 加入統計失敗:`, error);
                }
            }
        }
        return false;
    };

    const hasItems = (list) => list && (Array.isArray(list) ? list.length > 0 : (typeof list === 'object' ? Object.keys(list).length > 0 : false));

    let rawSkillList = [];
    let pot_skill1 = data.skill ? (Array.isArray(data.skill) ? data.skill : data.skill.skillList) : null;
    let pot_skill2 = data.skills ? (Array.isArray(data.skills) ? data.skills : data.skills.skillList) : null;
    let pot_skill3 = data.stigma || data.stigmaList || data.specialSkill || data.abyssSkill || [];

    if (hasItems(pot_skill1)) rawSkillList = pot_skill1;
    else if (hasItems(pot_skill2)) rawSkillList = pot_skill2;
    else rawSkillList = pot_skill3;
    const skillList = Array.isArray(rawSkillList) ? rawSkillList : Object.values(rawSkillList);

    skillList.forEach(s => {
        let bLv = boardSkillMap[s.name] || 0;
        let cLv = (cardSkillMap[s.name] || []).reduce((a, b) => a + b.lv, 0);


        // 🆕 查詢技能效果（使用新 API）
        let effectsHtml = "";
        const skillId = s.skillId || s.id;

        // 建立一個 placeholder，稍後異步更新
        const effectPlaceholderId = `skill-effect-${skillId}-${s.skillLevel}`;
        effectsHtml = `<br><br><b style="color:var(--gold);">📋 技能效果 (Lv.${s.skillLevel}):</b><br><span id="${effectPlaceholderId}" style="color:#8b949e; font-size:11px;">⏳ 載入中...</span>`;

        // 異步抓取技能資料
        if (skillId && window.SkillAPI) {
            window.SkillAPI.fetchSkill(skillId, s.skillLevel).then(skillInfo => {
                const placeholder = document.getElementById(effectPlaceholderId);
                const detailPlaceholder = document.getElementById(`passive-detail-${skillId}-${s.skillLevel}`);
                const formatted = window.SkillAPI.formatEffects(skillInfo);

                if (placeholder && skillInfo) {
                    placeholder.innerHTML = formatted;
                    placeholder.style.color = 'var(--green)';
                } else if (placeholder) {
                    placeholder.innerHTML = '💡 此技能效果數據尚未收錄';
                    placeholder.style.color = '#8b949e';
                }

                if (detailPlaceholder) {
                    detailPlaceholder.innerHTML = skillInfo ? formatted : '💡 數據未收錄';
                }
            }).catch(error => {
                console.error(`Failed to load skill ${skillId}:`, error);
                const placeholder = document.getElementById(effectPlaceholderId);
                const detailPlaceholder = document.getElementById(`passive-detail-${skillId}-${s.skillLevel}`);
                if (placeholder) {
                    placeholder.innerHTML = '❌ 載入失敗';
                    placeholder.style.color = '#ff6c6c';
                }
                if (detailPlaceholder) detailPlaceholder.innerHTML = '❌ 載入失敗';
            });
        }

        let iconUrl = s.icon || '';
        if (iconUrl && !iconUrl.startsWith('http')) {
            let parts = iconUrl.split('/');
            let filename = parts[parts.length - 1];
            if (filename.includes('.')) filename = filename.split('.')[0];
            iconUrl = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/' + filename + '.png';
        }
        let h = `<div class="skill-card" onmouseover="window.handleSkillHover(this, event)" onmouseout="window.handleSkillLeave(event)" onclick="window.handleSkillClick(this, event)">
                    <img src="${iconUrl}">
                    <div style="display:flex; flex-direction:column; justify-content:center; gap:2px;">
                        <span class="sk-name">${s.name}</span>
                        <span style="color:#94a3b8; font-size:11px; font-weight:600;">Lv.${s.skillLevel}</span>
                    </div>
                    <div class="skill-tip-data" style="display:none;" 
                         data-icon="${iconUrl}" 
                         data-name="${s.name}" 
                         data-category="${s.category}"
                         data-level="${s.skillLevel}"
                         data-base="${Math.max(0, s.skillLevel - bLv - cLv)}"
                         data-plate="${bLv}"
                         data-card="${cLv}">
                         ${effectsHtml}
                    </div>
                 </div>`;

        if (s.category === "Active") act += h;
        else if (s.category === "Passive") {
            pas += h;
            // 生成概覽分頁專用的詳細列表格式
            pasDetailed += `
                        <div class="stat-list-row expanded" style="cursor:default; border-bottom:1px solid rgba(255,255,255,0.03); display:block; padding:12px 15px;">
                            <div style="display:flex; align-items:flex-start; gap:12px;">
                                <img src="${iconUrl}" style="width:32px; height:32px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); margin-top:2px;">
                                <div style="flex:1;">
                                    <div style="font-size:14px; line-height:1.4;">
                                        <span style="font-weight:bold; color:var(--gold);">${s.name}:</span>
                                        <span id="passive-detail-${skillId}-${s.skillLevel}" style="color:var(--green); opacity:0.9;">⏳ 正在分析被動效果...</span>
                                    </div>
                                </div>
                            </div>
                        </div>`;
        } else sti += h;
    });
    document.getElementById('sk-act').innerHTML = act || "<div style='color:#8b949e; padding:10px;'>無主動技能</div>";
    document.getElementById('sk-pas').innerHTML = pas || "<div style='color:#8b949e; padding:10px;'>無被動技能</div>";
    document.getElementById('sk-stigma').innerHTML = sti || "<div style='color:#8b949e; padding:10px;'>無特殊技能</div>";

    // 儲存詳細版被動技能 HTML 以便在概覽分頁使用
    // 🛡️ 優先保留 updatePassiveSkills 所產生的 精確數據 HTML 
    const isCalculating = !window.__PASSIVE_SKILLS_HTML__ || window.__PASSIVE_SKILLS_HTML__.includes('⌛');
    if (isCalculating || !window.__PASSIVE_STATS_READY__) {
        window.__PASSIVE_SKILLS_HTML__ = pasDetailed || "<div style='color:#8b949e; padding:40px; text-align:center;'>此職業無被動加成技能</div>";
    }
}

function renderCombatAnalysis(stats, data) {
    const grid = document.getElementById('combat-stats-grid');
    if (!grid) return;

    // 🔍 狀態保存：記錄目前各區塊與明細行的展開狀態
    const savedStates = {};
    grid.querySelectorAll('[id^="combat-section-"], [id^="row-detail-"]').forEach(el => {
        if (el.style.display && el.style.display !== 'none') {
            savedStates[el.id] = el.style.display;
        }
    });

    // 切換為單欄佈局以適應新表格
    grid.style.display = 'block';
    grid.style.gridTemplateColumns = 'none';
    grid.style.gap = '0';

    const fmt = (v, isPerc, keyName) => {
        if (v === undefined || v === null) return '--';
        let val = parseFloat(v);

        // 🚨 修正 Aion Classic 特定屬性換算機制
        const sc1000_f = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
        const sc100_f = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
        const needsScale = keyName && (sc1000_f.some(k => keyName.includes(k)) || sc100_f.some(k => keyName.includes(k)));

        if (isPerc && needsScale && Math.abs(val) >= 20) {
            if (sc1000_f.some(k => keyName.includes(k)) && Math.abs(val) >= 40) {
                val = val / 1000;
            } else if (sc100_f.some(k => keyName.includes(k))) {
                val = val / 100;
            }
        }

        // 💡 智慧百分比：如果是百分比屬性，且小於 1 (如 0.06 = 6%)，自動轉為 100 倍以供 fmt 顯示
        // 但如果這是已經過比例縮放的特殊屬性 (scaleKeys)，則跳過此步驟，避免 0.1% 變成 10%
        if (isPerc && !needsScale && Math.abs(val) < 1 && Math.abs(val) > 0) {
            val = val * 100;
        }

        // 特別處理：如果 needsScale 且數值極小（轉換後的 0.1% = 0.1 點），保留更多小數位
        const decimals = (needsScale && Math.abs(val) < 1) ? 3 : 2;
        return Number(val.toFixed(decimals)) + (isPerc ? '%' : '');
    };

    // 增強版: 獲取完整屬性物件 (支援合併固定值、百分比及物理/魔法變體)
    const getStatEntry = (key) => {
        if (!key) return null;

        const cleanKey = key.replace('%', '').replace(/^(物理|魔法|屬性)/, '').trim();
        const baseKey = cleanKey;

        let entry = {
            key, total: 0,
            equipMain: 0, equipSub: 0, other: 0,
            nezakan: 0, zikel: 0, baizel: 0, triniel: 0, malkutan: 0, ariel: 0, asphel: 0,
            subtotals: { title: 0, mainStat: 0, arcana: 0, stone: 0, random: 0, wing: 0, wingHold: 0, gainEffect: 0, set: 0, skill: 0 },
            detailGroups: { base: [], random: [], stone: [], arcana: [], title: [], set: [], skill: [], wing: [], wingHold: [], gainEffect: [], mainStat: [], etc: [] },
            hasOfficialTotal: false
        };

        const guardians = [
            { k: 'nezakan', n: '奈薩肯', c: '#a29bfe' },
            { k: 'zikel', n: '吉凱爾', c: '#a29bfe' },
            { k: 'baizel', n: '白傑爾', c: '#a29bfe' },
            { k: 'triniel', n: '崔妮爾', c: '#a29bfe' },
            { k: 'malkutan', n: '瑪爾庫坦', c: '#a29bfe' },
            { k: 'ariel', n: '艾瑞爾', c: '#a29bfe' },
            { k: 'asphel', n: '阿斯佩爾', c: '#a29bfe' }
        ];

        // 💡 擴大匹配範圍：搜尋所有相關 Key
        const processed = new Set();
        let foundAny = false; // Initialize foundAny here
        Object.keys(stats).forEach(k => {
            const ck = k.replace('%', '').replace(/^(物理|魔法|屬性)/, '').trim();
            if (ck === baseKey) {
                const source = stats[k];
                if (source && !processed.has(source)) {
                    processed.add(source);
                    foundAny = true;

                    entry.equipMain += (source.equipMain || 0);
                    entry.equipSub += (source.equipSub || 0);
                    entry.other += (source.other || 0);

                    guardians.forEach(g => entry[g.k] = (entry[g.k] || 0) + (source[g.k] || 0));

                    if (source.hasOfficialTotal) {
                        entry.total = Math.max(entry.total, (source.total || 0));
                        entry.hasOfficialTotal = true;
                    }

                    for (let sk in source.subtotals) entry.subtotals[sk] = (entry.subtotals[sk] || 0) + source.subtotals[sk];
                    for (let gk in source.detailGroups) {
                        (source.detailGroups[gk] || []).forEach(str => {
                            entry.detailGroups[gk].push(str);
                        });
                    }
                }
            }
        });

        // 🚨 補丁：確保各類增益效果的細項 (儲存在 global GAIN_EFFECT_DATABASE) 被納入顯示
        const gainEffectMap = {
            '被動技能': 'skill',
            '稱號': 'title',
            '套裝效果': 'set',
            '手動增益': 'gainEffect',
            '能力轉化': 'mainStat'
        };

        if (window.GAIN_EFFECT_DATABASE) {
            Object.keys(window.GAIN_EFFECT_DATABASE).forEach(cat => {
                const db = window.GAIN_EFFECT_DATABASE[cat];
                if (db && db.active && db.breakdowns) {
                    // 💡 修正：增加 Key 變體查找 (% 與 非%)，解決稱號無法顯示的問題
                    let targetKey = null;
                    if (db.breakdowns[key]) {
                        targetKey = key;
                    } else {
                        const variant = key.includes('%') ? key.replace('%', '') : key + '%';
                        if (db.breakdowns[variant]) targetKey = variant;
                    }

                    if (targetKey) {
                        const targetGk = gainEffectMap[cat] || 'etc';
                        (db.breakdowns[targetKey] || []).forEach(str => {
                            if (!entry.detailGroups[targetGk].includes(str)) {
                                entry.detailGroups[targetGk].push(str);

                                // 同步累加 subtotal 以更新 Header 數值
                                const m = str.match(/:\s*\+?([\d\.]+)/);
                                if (m) {
                                    entry.subtotals[targetGk] += parseFloat(m[1]);
                                }
                            }
                        });
                    }
                }
            });
        }

        // 官方值兜底 (包含變體查找)
        if (!foundAny && data && data.stat && data.stat.statList) {
            const variants = [baseKey, baseKey + '%', '物理' + baseKey, '物理' + baseKey + '%', '魔法' + baseKey, '魔法' + baseKey + '%'];
            const officialList = data.stat.statList || [];
            const official = officialList.find(s => variants.includes(s.name.replace(/增加|提升/g, '').trim()));
            if (official && official.value !== undefined) {
                const valStr = official.value.toString().replace(/,/g, '').replace('%', '');
                let officialVal = parseFloat(valStr);

                // 🚨 修正備用路徑的官方總值縮放
                const sc1000_b = ['武器傷害增幅', '後方傷害增幅', '暴擊傷害增幅', '技能增益效果'];
                const sc100_b = ['靈識', '強擊', '多段打擊', '特殊打擊', '完美擊中', '完美'];
                if (official.value.toString().includes('%')) {
                    if (sc1000_b.some(sk => official.name.includes(sk)) && Math.abs(officialVal) >= 40) {
                        officialVal = officialVal / 1000;
                    } else if (sc100_b.some(sk => official.name.includes(sk)) && Math.abs(officialVal) >= 20) {
                        officialVal = officialVal / 100;
                    }
                }

                entry.total = officialVal;
                entry.hasOfficialTotal = true;
                foundAny = true;
            }
        }

        const bSum = (entry.nezakan || 0) + (entry.zikel || 0) + (entry.baizel || 0) + (entry.triniel || 0) + (entry.ariel || 0) + (entry.asphel || 0) + (entry.malkutan || 0);
        const sSum = (entry.subtotals?.title || 0) + (entry.subtotals?.wing || 0) + (entry.subtotals?.wingHold || 0) + (entry.subtotals?.arcana || 0) + (entry.subtotals?.skill || 0) + (entry.subtotals?.gainEffect || 0) + (entry.subtotals?.set || 0);
        // 裝備總分為: 基礎(equipMain) + 隨格(random) + 磨石(stone)
        const calcTotal = (entry.equipMain || 0) + (entry.subtotals?.random || 0) + (entry.subtotals?.stone || 0) + bSum + sSum + (entry.subtotals?.mainStat || 0);

        if (window.isExcludeBoardStats()) {
            entry.total = (entry.equipMain || 0) + (entry.subtotals?.random || 0) + (entry.subtotals?.stone || 0) + sSum + (entry.subtotals?.mainStat || 0);
        } else if (!entry.hasOfficialTotal || (calcTotal > entry.total + 0.1)) {
            entry.total = calcTotal;
        }
        return entry;
    };

    const generateDetailColumn = (entry, isPerc) => {
        if (!entry || !entry.key) return `<div style="flex:1;"></div>`;

        if (entry.isOfficial) {
            return `<div style="flex:1; font-size:12px; color:#666; text-align:center; padding:10px;">來源: 官方提供的面板數值</div>`;
        }

        const fmtVal = (v) => fmt(v, isPerc, entry.key);
        const TH = 0.001;

        let html = `<div style="flex:1; font-size:11px; padding:10px; background:rgba(255,255,255,0.02); border-radius:8px; display:flex; flex-direction:column; gap:8px;">`;
        let hasContent = false;

        // Guardian Stats
        let guardianHtml = ``;
        const guardians = [
            { k: 'nezakan', n: '奈薩肯', c: '#a29bfe' },
            { k: 'zikel', n: '吉凱爾', c: '#a29bfe' },
            { k: 'baizel', n: '白傑爾', c: '#a29bfe' },
            { k: 'triniel', n: '崔妮爾', c: '#a29bfe' },
            { k: 'malkutan', n: '瑪爾庫坦', c: '#a29bfe' },
            { k: 'ariel', n: '艾瑞爾', c: '#a29bfe' },
            { k: 'asphel', n: '阿斯佩爾', c: '#a29bfe' }
        ];

        let guardianCount = 0;
        let boardSum = 0;
        if (!window.isExcludeBoardStats()) {
            guardians.forEach(g => {
                const val = entry[g.k] || 0;
                if (Math.abs(val) > TH) {
                    boardSum += val;
                    guardianCount++;
                }
            });

            if (guardianCount > 0) {
                guardianHtml += `<div>
                                    <div style="color:#a29bfe; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
                                        <span>📋 守護力板塊</span>
                                        <span style="color:#fff; font-weight:bold;">${fmtVal(boardSum)}</span>
                                    </div>
                                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:4px;">`;

                guardians.forEach(g => {
                    const val = entry[g.k] || 0;
                    if (Math.abs(val) > TH) {
                        guardianHtml += `<div style="display:flex; justify-content:space-between;"><span style="color:${g.c};">${g.n}</span><span style="color:#fff;">${fmtVal(val)}</span></div>`;
                        hasContent = true;
                    }
                });

                guardianHtml += `</div></div>`;
            }
        }

        html += guardianHtml;

        // Helper string layout
        const renderCategory = (groupKey, icon, color, label, sumVal) => {
            const list = entry.detailGroups?.[groupKey] || [];
            if (list.length === 0 && Math.abs(sumVal || 0) <= TH) return ``;

            hasContent = true;
            let catHtml = `<div style="margin-bottom:2px;">`;

            // Header
            let sumHtml = sumVal ? `<span style="color:#fff; font-weight:bold;">${fmtVal(sumVal)}</span>` : '';
            catHtml += `<div style="display:flex; justify-content:space-between; align-items:center; color:${color}; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:4px;">
                            <span>${icon} ${label}</span>
                            ${sumHtml}
                        </div>`;

            // Items — 單欄排版，每行一件裝備
            if (list.length > 0) {
                catHtml += `<div style="display:flex; flex-direction:column; gap:3px; padding-left:8px;">`;
                list.forEach(str => {
                    let colonIdx = str.indexOf(':');
                    if (colonIdx > -1) {
                        let name = str.substring(0, colonIdx).trim().replace(/^\[|\]$/g, '');
                        let valPart = str.substring(colonIdx + 1).trim();

                        let nameStyle = `color:${color}; opacity:0.85;`;
                        if (groupKey === 'base' || groupKey === 'random') {
                            nameStyle = 'color:#bdc3c7;';
                        }

                        catHtml += `<div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap;">
                                    <span style="${nameStyle} white-space:nowrap;">${name}</span>
                                    <span style="color:#fff; flex-shrink:0; word-break:break-all; text-align:right;">${valPart}</span>
                                </div>`;
                    } else {
                        catHtml += `<div><span style="color:${color}; opacity:0.85;">${str}</span></div>`;
                    }
                });
                catHtml += `</div>`;
            }
            catHtml += `</div>`;
            return catHtml;
        };

        html += renderCategory('base', '🛡️', '#58a6ff', '裝備基礎', entry.equipMain);
        html += renderCategory('random', '🎲', '#a29bfe', '隨機屬性', entry.subtotals?.random);
        html += renderCategory('stone', '💎', '#e67e22', '磨石與加成', entry.subtotals?.stone);
        html += renderCategory('set', '📦', '#fab1a0', '套裝效果', entry.subtotals?.set);
        html += renderCategory('skill', '⚡', '#fd79a8', '技能', entry.subtotals?.skill);
        html += renderCategory('title', '🎖️', '#ffd700', '稱號', entry.subtotals?.title);
        html += renderCategory('wing', '🪽', '#81ecec', '翅膀', entry.subtotals?.wing);
        html += renderCategory('wingHold', '🪽', '#81ecec', '翅膀收藏', entry.subtotals?.wingHold);
        html += renderCategory('arcana', '🎴', '#ff7675', '聖物', entry.subtotals?.arcana);
        html += renderCategory('gainEffect', '💊', '#fdcb6e', '增益', entry.subtotals?.gainEffect);
        html += renderCategory('mainStat', '📊', '#74b9ff', '轉化', entry.subtotals?.mainStat);

        if (!hasContent) return `<div style="flex:1; font-size:12px; color:#666; text-align:center; padding:10px;">未偵測到細項來源</div>`;

        html += `</div>`;
        return html;
    };

    // --- 💡 戰力計算說明彈窗 ---
    window.openCalculationGuide = function () {
        const el = document.getElementById('guide-overlay');
        if (el) {
            el.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    };

    const sections = [
        {
            title: "主要能力值",
            rows: [
                ["攻擊力", "額外攻擊力"],
                ["防禦力", "額外防禦力"],
                ["命中", "額外命中"],
                ["迴避", "額外迴避"],
                ["暴擊", "暴擊抵抗"],
                ["生命力", "精神力"],
                ["戰鬥速度%", "移動速度%"]
            ]
        },
        {
            title: "百分比增加",
            rows: [
                ["攻擊力增加", "防禦力增加"],
                ["命中增加", "迴避增加"],
                ["暴擊增加", "暴擊抵抗增加"],
                ["格擋貫穿", "格擋增加"],
                ["生命力增加", "精神力增加"]
            ]
        },
        {
            title: "戰鬥",
            rows: [
                ["貫穿", "封魂石額外傷害"],
                ["最大攻擊力", "最小攻擊力"],
                ["暴擊攻擊力", "暴擊防禦力"],
                ["後方攻擊力", "後方防禦力"],
                ["傷害增幅", "傷害耐性"],
                ["武器傷害增幅", "武器傷害耐性"],
                ["暴擊傷害增幅", "暴擊傷害耐性"],
                ["後方傷害增幅", "後方傷害耐性"]
            ]
        },
        {
            title: "判定",
            rows: [
                ["多段打擊擊中", "多段打擊抵抗"],
                ["後方暴擊", "後方暴擊抵抗"],
                ["格擋貫穿", "格擋"],
                ["鐵壁貫穿", "鐵壁"],
                ["再生貫穿", "再生"],
                ["完美", "完美抵抗"],
                ["強擊", "強擊抵抗"]
            ]
        },
        {
            title: "異常狀態",
            rows: [
                ["異常狀態擊中", "異常狀態抵抗"],
                ["衝擊系擊中", "衝擊系抵抗"],
                ["精神系擊中", "精神系抵抗"],
                ["肉體系擊中", "肉體系抵抗"],
                ["氣絕擊中", "氣絕抵抗"],
                ["束縛擊中", "束縛抵抗"],
                ["空中束縛擊中", "空中束縛抵抗"],
                ["挑釁擊中", "挑釁抵抗"],
                ["封印擊中", "封印抵抗"],
                ["恐懼擊中", "恐懼抵抗"],
                ["變異擊中", "變異抵抗"],
                ["擊倒擊中", "擊倒抵抗"],
                ["冰結擊中", "冰結抵抗"],
                ["睡眠擊中", "睡眠抵抗"],
                ["石化擊中", "石化抵抗"],
                ["麻痺擊中", "麻痺抵抗"],
                ["中毒擊中", "中毒抵抗"],
                ["出血擊中", "出血抵抗"],
                ["失明擊中", "失明抵抗"],
                ["無力擊中", "無力抵抗"],
                ["遲緩擊中", "遲緩抵抗"],
                ["擒拿擊中", "擒拿抵抗"]
            ]
        },
        {
            title: "PVP",
            rows: [
                ["PVP攻擊力", "PVP防禦力"],
                ["PVP傷害增幅", "PVP傷害耐性"],
                ["PVP命中", "PVP迴避"],
                ["PVP暴擊", "PVP暴擊抵抗"]
            ]
        },
        {
            title: "PVE",
            rows: [
                ["PVE攻擊力", "PVE防禦力"],
                ["PVE命中", "PVE迴避"],
                ["PVE傷害增幅", "PVE傷害耐性"],
                ["首領攻擊力", "首領防禦力"],
                ["首領傷害增幅", "首領傷害耐性"]
            ]
        },
        {
            title: "種族",
            rows: [
                ["知性族攻擊力", "知性族防禦力"],
                ["知性族命中", "知性族迴避"],
                ["知性族暴擊", "知性族暴擊抵抗"],
                ["知性族格擋貫穿", "知性族格擋"],
                ["知性族傷害增幅", "知性族傷害耐性"],

                ["野性族攻擊力", "野性族防禦力"],
                ["野性族命中", "野性族迴避"],
                ["野性族暴擊", "野性族暴擊抵抗"],
                ["野性族格擋貫穿", "野性族格擋"],
                ["野性族傷害增幅", "野性族傷害耐性"],

                ["自然族攻擊力", "自然族防禦力"],
                ["自然族命中", "自然族迴避"],
                ["自然族暴擊", "自然族暴擊抵抗"],
                ["自然族格擋貫穿", "自然族格擋"],
                ["自然族傷害增幅", "自然族傷害耐性"],

                ["變形族攻擊力", "變形族防禦力"],
                ["變形族命中", "變形族迴避"],
                ["變形族暴擊", "變形族暴擊抵抗"],
                ["變形族格擋貫穿", "變形族格擋"],
                ["變形族傷害增幅", "變形族傷害耐性"]
            ]
        },
        {
            title: "屬性",
            rows: [
                ["水屬性攻擊力", "水屬性防禦力"],
                ["火屬性攻擊力", "火屬性防禦力"],
                ["風屬性攻擊力", "風屬性防禦力"],
                ["地屬性攻擊力", "地屬性防禦力"],
                ["水屬性增幅", "水屬性耐性"],
                ["火屬性增幅", "火屬性耐性"],
                ["風屬性增幅", "風屬性耐性"],
                ["地屬性增幅", "地屬性耐性"]
            ]
        },
        {
            title: "特殊",
            rows: [
                ["疾走速度", "飛行速度"],
                ["坐騎地面移動速度", "坐騎疾走消耗減少"],
                ["治療增幅", "所受治癒量"],
                ["冷卻時間", "敵對值獲得量"],
                ["冷卻時間減少", ""]
            ]
        },
        {
            title: "資源",
            rows: [
                ["行動力", "飛行力"],
                ["生命力自然恢復", "精神力自然恢復"],
                ["戰鬥生命力自然恢復", "非戰鬥生命力自然恢復"],
                ["生命力藥水恢復", "生命力藥水恢復增加"],
                ["戰鬥精神力自然恢復", "非戰鬥精神力自然恢復"],
                ["精神力消耗量", "精神力獲得增加"],
                ["戰鬥行動力自然恢復", "非戰鬥行動力自然恢復"],
                ["戰鬥飛行力自然恢復", "非戰鬥飛行力自然恢復"],

            ]
        }
    ];

    // 💡 屬性名稱渲染 helper (包含 Tooltip)
    const renderStatLabelWithTooltip = (key) => {
        if (!key) return '';
        // 移除常見的前綴與符號以匹配 JSON Key
        const cleanKey = key.replace('%', '').replace(/增加|提升/g, '').trim();
        const desc = window.STAT_DESCRIPTIONS ? window.STAT_DESCRIPTIONS[cleanKey] : null;
        const displayName = key.replace('%', '增加');

        if (desc) {
            return `<div class="custom-tooltip-trigger" style="position:relative; display:inline-flex; align-items:center;">
                        <span style="font-size:13px; color:#bdc3c7; border-bottom:1px dotted rgba(255,255,255,0.4); cursor:help;">${displayName}</span>
                        <div class="custom-tooltip-content" style="display:none; position:absolute; bottom:140%; left:50%; transform:translateX(-50%); background:rgba(15,20,25,0.98); border:1px solid var(--border); border-radius:6px; padding:10px; width:260px; z-index:1002; box-shadow:0 4px 20px rgba(0,0,0,0.6); pointer-events:none; font-size:12px; color:#8b949e; text-align:left; white-space:normal; word-break:break-word;">
                            <b style="color:var(--gold); display:block; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px; padding-bottom:5px;">📊 ${cleanKey} 說明</b>
                            <div style="line-height:1.5; color:#e6edf3;">${desc.replace(/\n/g, '<br>')}</div>
                            <!-- Arrow -->
                            <div style="position:absolute; top:100%; left:50%; transform:translateX(-50%); border-width:6px; border-style:solid; border-color:rgba(15,20,25,0.98) transparent transparent transparent;"></div>
                        </div>
                    </div>`;
        }
        return `<span style="font-size:13px; color:#bdc3c7;">${displayName}</span>`;
    };

    let html = `<div style="display:flex; flex-direction:column; gap:10px; padding-top:12px;">`;

    // 定義需要收合的區塊標題（所有區塊都可收合）
    const collapsibleTitles = ["主要能力值", "百分比增加", "戰鬥", "PVE", "PVP", "判定", "異常狀態", "種族", "屬性", "特殊", "資源"];
    // 預設收合的區塊（主要能力值預設展開，其餘預設收合）
    const defaultCollapsedTitles = ["百分比增加", "戰鬥", "PVE", "PVP", "判定", "異常狀態", "種族", "屬性", "特殊", "資源"];
    const totalSections = sections.length;

    // 🛡️ 全局控制按鈕 (移動至置頂標頭容器)
    const activeHeaderControls = document.getElementById('combat-analysis-global-controls');
    if (activeHeaderControls) {
        const isStickyDisabled = localStorage.getItem('sticky_header_disabled') === 'true';
        const headerEl = document.querySelector('.card-sticky-header');
        if (headerEl) {
            if (isStickyDisabled) headerEl.classList.add('sticky-disabled');
            else headerEl.classList.remove('sticky-disabled');
        }

        activeHeaderControls.innerHTML = `
            <button onclick="window.openCalculationGuide()" class="btn-mobile-hide"
                style="background:rgba(255,215,0,0.1); border:1px solid rgba(255,215,0,0.3); color:#ffd700; cursor:pointer; font-size:11px; padding:4px 10px; border-radius:4px; transition:all 0.2s; white-space:nowrap; margin-right:5px;"
                onmouseover="this.style.background='rgba(255,215,0,0.2)';"
                onmouseout="this.style.background='rgba(255,215,0,0.1)';" title="查看戰力指標計算說明">
                💡 使用說明
            </button>
            <button id="btn-sticky-header" onclick="window.toggleStickyHeader()" 
                style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#8b949e; cursor:pointer; font-size:11px; padding:4px 10px; border-radius:4px; transition:all 0.2s; white-space:nowrap;"
                onmouseover="this.style.borderColor='var(--gold)'; this.style.color='#fff';"
                onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'; this.style.color='#8b949e';">
                ${isStickyDisabled ? '📌 釘選標頭' : '🔓 取消固定'}
            </button>
            <button onclick="(function(){
                for(let i=0;i<${totalSections};i++){
                    const c=document.getElementById('combat-section-'+i);
                    const ic=document.getElementById('combat-icon-'+i);
                    if(c){c.style.display='block';}
                    if(ic){ic.style.transform='rotate(0deg)';}
                }
            })()" style="background:rgba(88,166,255,0.15); border:1px solid rgba(88,166,255,0.3); color:#58a6ff; cursor:pointer; font-size:11px; padding:4px 12px; border-radius:4px; transition:all 0.2s; white-space:nowrap;" onmouseover="this.style.background='rgba(88,166,255,0.25)'" onmouseout="this.style.background='rgba(88,166,255,0.15)'">全部展開 ▼</button>
            <button onclick="(function(){
                for(let i=0;i<${totalSections};i++){
                    const c=document.getElementById('combat-section-'+i);
                    const ic=document.getElementById('combat-icon-'+i);
                    if(c){c.style.display='none';}
                    if(ic){ic.style.transform='rotate(-90deg)';}
                }
            })()" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#8b949e; cursor:pointer; font-size:11px; padding:4px 12px; border-radius:4px; transition:all 0.2s; white-space:nowrap;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">全部收合 ▲</button>
            <button id="btn-pin-stats" onclick="window.togglePinStats()" class="btn-mobile-hide"
                style="background:${window._statsPinned ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${window._statsPinned ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.1)'}; color:${window._statsPinned ? '#ffd700' : '#8b949e'}; cursor:pointer; font-size:11px; padding:4px 12px; border-radius:4px; transition:all 0.2s; white-space:nowrap;"
                onmouseover="this.style.borderColor='var(--gold)'; this.style.color='#ffd700';"
                onmouseout="if(!window._statsPinned){this.style.borderColor='rgba(255,255,255,0.1)'; this.style.color='#8b949e';}">
                ${window._statsPinned ? '📌 取消預覽' : '📌 預覽指標'}
            </button>
        `;
    }

    // 定義全局切換函數
    if (!window.toggleStickyHeader) {
        window.toggleStickyHeader = function () {
            const header = document.querySelector('.card-sticky-header');
            if (!header) return;
            const isDisabled = header.classList.toggle('sticky-disabled');
            localStorage.setItem('sticky_header_disabled', isDisabled);

            // 不刷新重新渲染資料以免遺失狀態，只更新按鈕文字
            const btn = document.getElementById('btn-sticky-header');
            if (btn) {
                btn.innerHTML = isDisabled ? '📌 釘選標頭' : '🔓 取消固定';
            }

            // 同步更新預覽指標面板的 top offset
            const pinnedPanel = document.getElementById('pinned-stats-panel');
            if (pinnedPanel && window._statsPinned) {
                const hdrH = isDisabled ? 0 : header.offsetHeight;
                pinnedPanel.style.top = (hdrH + 8) + 'px';
            }
        }
    }

    // 📌 釘選戰力指標功能 — 直接讀取主要能力值概覽的計算結果
    window._renderPinnedPreview = function () {
        const panel = document.getElementById('pinned-stats-panel');
        if (!panel || !window._statsPinned) return;

        const values = window.__PINNED_STAT_VALUES__ || [];
        if (values.length === 0) {
            panel.innerHTML = '<div style="color:#8b949e; font-size:11px; text-align:center; padding:10px;">尚無計算資料</div>';
            return;
        }

        let html = `<div style="font-size:11px; font-weight:bold; color:var(--gold); padding-bottom:6px; border-bottom:1px solid rgba(255,215,0,0.2); margin-bottom:4px; text-align:center;">
                        📌 戰力指標
                    </div>`;

        values.forEach(item => {
            const valStr = (item.val === 0 || item.val === '0') ? '--' : item.val;
            html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 2px; border-bottom:1px solid rgba(255,255,255,0.03);">
                        <span style="color:#8b949e; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.icon} ${item.name}</span>
                        <span style="color:#fff; font-size:11px; font-weight:bold; font-family:'Outfit',sans-serif; flex-shrink:0; margin-left:4px;">${valStr}</span>
                    </div>`;
        });

        panel.innerHTML = html;
    };

    if (!window.togglePinStats) {
        window.togglePinStats = function () {
            const isPinned = window._statsPinned;
            const pinnedPanel = document.getElementById('pinned-stats-panel');
            const btn = document.getElementById('btn-pin-stats');

            if (!pinnedPanel) return;

            if (!isPinned) {
                // === 釘選 ===
                window._statsPinned = true;
                pinnedPanel.style.display = 'block';

                // 動態計算釘選標頭高度，讓預覽面板從標頭下方開始 sticky
                const stickyHdr = document.querySelector('.card-sticky-header:not(.sticky-disabled)');
                const hdrH = stickyHdr ? stickyHdr.offsetHeight : 0;
                pinnedPanel.style.top = (hdrH + 8) + 'px';

                window._renderPinnedPreview();

                if (btn) {
                    btn.innerHTML = '📌 取消釘選';
                    btn.style.background = 'rgba(255,215,0,0.2)';
                    btn.style.borderColor = 'rgba(255,215,0,0.4)';
                    btn.style.color = '#ffd700';
                }
            } else {
                // === 取消釘選 ===
                window._statsPinned = false;
                pinnedPanel.style.display = 'none';
                pinnedPanel.innerHTML = '';

                if (btn) {
                    btn.innerHTML = '📌 預覽指標';
                    btn.style.background = 'rgba(255,255,255,0.05)';
                    btn.style.borderColor = 'rgba(255,255,255,0.1)';
                    btn.style.color = '#8b949e';
                }
            }
        };
    }

    sections.forEach((section, sIdx) => {
        const isCollapsible = collapsibleTitles.includes(section.title);
        const isCollapsed = defaultCollapsedTitles.includes(section.title);
        const contentId = `combat-section-${sIdx}`;
        const iconId = `combat-icon-${sIdx}`;

        html += `
                <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; overflow:visible;">
                    <div 
                        onclick="${isCollapsible ? `(function(){
                            const content = document.getElementById('${contentId}');
                            const icon = document.getElementById('${iconId}');
                            if(content.style.display === 'none'){
                                content.style.display = 'block';
                                icon.style.transform = 'rotate(0deg)';
                            } else {
                                content.style.display = 'none';
                                icon.style.transform = 'rotate(-90deg)';
                            }
                        })()` : ''}"
                        style="background:rgba(255,255,255,0.05); padding:8px 15px; font-weight:bold; color:var(--gold); border-bottom:1px solid rgba(255,255,255,0.05); font-size:14px; display:flex; justify-content:space-between; align-items:center; cursor:${isCollapsible ? 'pointer' : 'default'};">
                        <span>${section.title}</span>
                        ${isCollapsible ? `<span id="${iconId}" style="transition:transform 0.3s; transform: rotate(${isCollapsed ? '-90deg' : '0deg'}); font-size:12px;">▼</span>` : ''}
                    </div>
                    <div id="${contentId}" style="padding:0; display:${isCollapsed ? 'none' : 'block'};">`;

        section.rows.forEach((row, rIdx) => {
            const leftKey = row[0];
            const rightKey = row[1];
            // 使用 getStatEntry
            const leftEntry = getStatEntry(leftKey);
            const rightEntry = getStatEntry(rightKey);

            const hasLeftBreakdown = leftEntry && Object.values(leftEntry.detailGroups).some(arr => arr.length > 0);
            const hasRightBreakdown = rightEntry && Object.values(rightEntry.detailGroups).some(arr => arr.length > 0);

            // 修正: 檢查 total 是否為 0 (且沒有 breakdown) 才顯示 --
            const hasLeftVal = leftEntry && (leftEntry.total !== 0 || hasLeftBreakdown || leftEntry.isOfficial);
            const hasRightVal = rightEntry && (rightEntry.total !== 0 || hasRightBreakdown || rightEntry.isOfficial);

            // 只要有數據就可以展開 (即使是 0，如果有細項)
            const canExpand = hasLeftVal || hasRightVal;

            const rowDetailId = `row-detail-${sIdx}-${rIdx}`;
            const rowIconId = `row-icon-${sIdx}-${rIdx}`;

            html += `<div 
                                onclick="${canExpand ? `(function(){
                                    const d = document.getElementById('${rowDetailId}');
                                    const arrow = document.getElementById('${rowIconId}');
                                    if(d.style.display==='none'){
                                        d.style.display='flex';
                                        if(arrow) arrow.style.transform='rotate(0deg)';
                                        setTimeout(function(){
                                            const sh = document.querySelector('.card-sticky-header:not(.sticky-disabled)');
                                            const hh = sh ? sh.offsetHeight : 0;
                                            if(hh > 0){
                                                const rowEl = d.previousElementSibling;
                                                if(rowEl){
                                                    const rt = rowEl.getBoundingClientRect().top + window.scrollY - hh - 8;
                                                    window.scrollTo({ top: rt, behavior: 'smooth' });
                                                }
                                            }
                                        }, 50);
                                    }else{
                                        d.style.display='none';
                                        if(arrow) arrow.style.transform='rotate(-90deg)';
                                    }
                                })() ` : ''}"
                                style="cursor:${canExpand ? 'pointer' : 'default'}; border-bottom:1px solid rgba(255,255,255,0.02);">
                                
                                <div style="display:flex; ${rIdx % 2 === 0 ? '' : 'background:rgba(255,255,255,0.015);'} padding:8px 15px; align-items:center; min-height:28px;">
                                    
                                    <!-- Left Column -->
                                    <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
                                        <div style="display:flex; align-items:center; gap:5px;">
                                            ${canExpand && leftKey ? `<span id="${rowIconId}" style="color:#58a6ff; font-size:10px; transition:transform 0.2s; transform:rotate(-90deg); width:12px; display:inline-block;">▶</span>` : ''}
                                            ${renderStatLabelWithTooltip(leftKey)}
                                        </div>
                                        <span style="font-size:13px; font-weight:bold; color:#fff;">${(leftKey && hasLeftVal) ? fmt(leftEntry.total, leftKey.includes('%'), leftKey) : (leftKey ? '--' : '')}</span>
                                    </div>

                                    <!-- Spacer -->
                                    <div style="width:20px;"></div>

                                    <!-- Right Column -->
                                    <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
                                        ${renderStatLabelWithTooltip(rightKey)}
                                        <span style="font-size:13px; font-weight:bold; color:#fff;">${(rightKey && hasRightVal) ? fmt(rightEntry.total, rightKey.includes('%'), rightKey) : (rightKey ? '--' : '')}</span>
                                    </div>
                                </div>

                                <!-- Detail Row (Hidden) -->
                                <div id="${rowDetailId}" style="display:none; padding:10px 15px 15px 15px; background:rgba(0,0,0,0.2); border-top:1px dashed rgba(255,255,255,0.1); gap:20px; overflow:hidden; max-width:100%; box-sizing:border-box;">
                                    <div style="flex:1; min-width:0;">
                                        ${leftKey ? `<div class="detail-col-label" style="font-size:11px; font-weight:bold; color:#58a6ff; margin-bottom:6px; display:none;">▸ ${leftKey.replace('%', '增加')}</div>` : ''}
                                        ${generateDetailColumn(leftEntry, leftKey ? normalizeKey(leftKey).includes('%') : false)}
                                    </div>
                                    ${rightKey ? `<div style="flex:1; min-width:0;">
                                        <div class="detail-col-label" style="font-size:11px; font-weight:bold; color:#58a6ff; margin-bottom:6px; display:none;">▸ ${rightKey.replace('%', '增加')}</div>
                                        ${generateDetailColumn(rightEntry, rightKey ? normalizeKey(rightKey).includes('%') : false)}
                                    </div>` : generateDetailColumn(rightEntry, rightKey ? normalizeKey(rightKey).includes('%') : false)}
                                </div>
                            </div>`;
        });

        html += `</div></div>`;
    });

    html += `</div>`;
    grid.innerHTML = html;

    // 🔍 狀態還原：根據記錄恢復展開狀態
    Object.keys(savedStates).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = savedStates[id];
            // 同步更新箭頭旋轉狀態
            const iconId = id.replace('combat-section-', 'combat-icon-').replace('row-detail-', 'row-icon-');
            const icon = document.getElementById(iconId);
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    });
}





// Tooltip 點擊固定功能
document.addEventListener('DOMContentLoaded', function () {
    // Tooltip 點擊固定功能 - 修正版
    document.addEventListener('click', function (e) {
        // 1. 如果點擊的是關閉按鈕 -> 關閉並返回
        const closeBtn = e.target.closest('.tooltip-close-btn');
        if (closeBtn) {
            const tooltip = closeBtn.closest('.tooltip');
            if (tooltip) {
                tooltip.classList.remove('tooltip-pinned');
                // 💡 強制隱藏：避免點擊關閉後，因滑鼠仍在卡片上導致 CSS :hover 繼續顯示
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
                tooltip.style.pointerEvents = 'none';
            }
            e.stopPropagation();
            return;
        }

        // 2. 如果點擊的是 tooltip 內部內容 -> 不做任何事 (保持開啟)
        if (e.target.closest('.tooltip')) {
            return;
        }

        // 3. 如果點擊的是觸發區域
        const trigger = e.target.closest('.hover-calc, .skill-card, .stat-mini-card, th.th-hover');
        if (trigger) {
            const tooltip = trigger.querySelector('.tooltip');
            if (tooltip) {
                // 點擊觸發區域時，先重設可能存在的強制隱藏狀態
                tooltip.style.visibility = '';
                tooltip.style.opacity = '';
                tooltip.style.pointerEvents = '';

                // 如果已經是開啟狀態，且點擊的是觸發容器本身（而非內容），則切換狀態 (toggle)
                if (tooltip.classList.contains('tooltip-pinned')) {
                    tooltip.classList.remove('tooltip-pinned');
                } else {
                    // 關閉其他已開啟的 tooltip
                    document.querySelectorAll('.tooltip.tooltip-pinned').forEach(t => {
                        if (t !== tooltip) t.classList.remove('tooltip-pinned');
                    });
                    tooltip.classList.add('tooltip-pinned');
                }
                e.stopPropagation();
            }
        }
    });

    // 🛡️ 當滑鼠離開觸發區域時，重設被強制隱藏的 Tooltip 狀態，讓下次 Hover 能正常顯示
    document.addEventListener('mouseout', function (e) {
        const trigger = e.target.closest('.hover-calc, .skill-card, .stat-mini-card, th.th-hover');
        if (trigger && !trigger.contains(e.relatedTarget)) {
            const tooltip = trigger.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = '';
                tooltip.style.opacity = '';
                tooltip.style.pointerEvents = '';
            }
        }
    });

    // 🛡️ 技能卡片 Tooltip 智能定位 (防止超出螢幕)
    document.addEventListener('mouseover', function (e) {
        const card = e.target.closest('.skill-card');
        if (card) {
            const tooltip = card.querySelector('.tooltip');
            if (tooltip) {
                const cardRect = card.getBoundingClientRect();
                const parent = card.parentElement; // .skill-list or similar

                if (parent) {
                    const parentRect = parent.getBoundingClientRect();
                    // 計算卡片在容器內的相對中心點位置
                    const relativeCenter = (cardRect.left - parentRect.left) + (cardRect.width / 2);
                    const parentWidth = parentRect.width;

                    // 如果在容器右半邊，則 Tooltip 靠右顯示
                    if (relativeCenter > parentWidth * 0.5) {
                        tooltip.style.left = 'auto';
                        tooltip.style.right = '0';
                        tooltip.style.transform = 'none';
                    } else {
                        // 在容器左半邊，Tooltip 靠左顯示
                        tooltip.style.left = '0';
                        tooltip.style.right = 'auto';
                        tooltip.style.transform = 'none';
                    }
                }
            }
        }
    });

    // 表頭 tooltip 動態定位 (使用 fixed 定位,顯示在表頭下方)
    document.addEventListener('mouseover', function (e) {
        const thHover = e.target.closest('thead th.th-hover');
        if (thHover) {
            const tooltip = thHover.querySelector('.tooltip');
            if (tooltip) {
                const rect = thHover.getBoundingClientRect();
                // 顯示在表頭下方,增加足夠的間距(約一行表格的高度)避免被遮擋
                tooltip.style.top = (rect.bottom + 50) + 'px';
                tooltip.style.left = (rect.left + rect.width / 2) + 'px';
                tooltip.style.transform = 'translateX(-50%)';
            }
        }
    });

});






// 雷達圖繪製函數
let radarChartInstance = null;

window.renderRadarChart = function () {
    // 獲取當前的評分數據
    const scoreData = window.currentEquipmentScore;
    if (!scoreData || !scoreData.breakdown) {
        console.warn('No score data available for radar chart');
        return;
    }

    const breakdown = scoreData.breakdown;

    // 計算各維度的百分比
    const dimensions = [
        {
            label: '裝備強度',
            score: breakdown.rarity.score,
            max: breakdown.rarity.maxScore,
            percentage: (breakdown.rarity.score / breakdown.rarity.maxScore * 100).toFixed(1)
        },
        {
            label: '板塊進度',
            score: breakdown.board.score,
            max: breakdown.board.maxScore,
            percentage: (breakdown.board.score / breakdown.board.maxScore * 100).toFixed(1)
        },
        {
            label: '寵物理解',
            score: breakdown.petInsight.score,
            max: breakdown.petInsight.maxScore,
            percentage: (breakdown.petInsight.score / breakdown.petInsight.maxScore * 100).toFixed(1)
        },
        {
            label: '技能烙印',
            score: breakdown.stigma.score,
            max: breakdown.stigma.maxScore,
            percentage: (breakdown.stigma.score / breakdown.stigma.maxScore * 100).toFixed(1)
        },
        {
            label: '稱號收集',
            score: breakdown.title.score,
            max: breakdown.title.maxScore,
            percentage: (breakdown.title.score / breakdown.title.maxScore * 100).toFixed(1)
        }
    ];

    // 銷毀舊的圖表實例
    if (radarChartInstance) {
        radarChartInstance.destroy();
    }

    // 獲取 canvas 元素
    const ctx = document.getElementById('radarChart');
    if (!ctx) {
        console.error('Radar chart canvas not found');
        return;
    }

    // 創建雷達圖
    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: dimensions.map(d => d.label),
            datasets: [{
                label: '當前進度',
                data: dimensions.map(d => parseFloat(d.percentage)),
                backgroundColor: 'rgba(0, 212, 255, 0.2)',
                borderColor: 'rgba(0, 212, 255, 1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(0, 212, 255, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(0, 212, 255, 1)',
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    min: 0,
                    ticks: {
                        stepSize: 20,
                        color: '#8b949e',
                        backdropColor: 'transparent',
                        font: {
                            size: 11
                        },
                        callback: function (value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: 'rgba(139, 148, 158, 0.2)'
                    },
                    angleLines: {
                        color: 'rgba(139, 148, 158, 0.2)'
                    },
                    pointLabels: {
                        color: '#ffd93d',
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 20, 25, 0.95)',
                    titleColor: '#ffd93d',
                    bodyColor: '#fff',
                    borderColor: '#00d4ff',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const dim = dimensions[context.dataIndex];
                            return [
                                `得分: ${dim.score} / ${dim.max}`,
                                `完成度: ${dim.percentage}%`
                            ];
                        }
                    }
                }
            }
        }
    });
};



/**
 * NEW: Render the visual equipment layout (Basic Tab)
 */
/**
 * NEW: Render the visual equipment layout (Basic Tab) - Final Triple Column UI
 */
window.renderLayoutTab = function (json) {
    if (!json) return;
    const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
    const sidebar = document.getElementById('equip-sidebar-profile');
    const container = document.getElementById('equip-tab-layout');
    if (!data) return;

    // --- 1. Basic Info & Ratings ---
    const p = data.profile || {};
    const pImg = getCorrectIcon(p.profileImage || "");
    const itemLvObj = data.stat.statList.find(s => s.type === "ItemLevel");
    const itemLv = itemLvObj ? itemLvObj.value : 0;

    const rating = json.rating || (json.queryResult ? json.queryResult.rating : null);
    const ratingsData = (json.queryResult && json.queryResult.ratings) ? json.queryResult.ratings :
        (json.ratings ? json.ratings :
            ((data && data.ratings) ? data.ratings :
                ((rating && rating.ratings) ? rating.ratings : null)));

    const pveScore = (ratingsData && ratingsData.PVE) ? ratingsData.PVE.score : 0;
    const pvpScore = (ratingsData && ratingsData.PVP) ? ratingsData.PVP.score : 0;

    // --- Percentile Data ---
    const percentile = rating ? rating.percentile : null;
    let percentileHtml = '';
    if (percentile) {
        const ptItems = [
            { label: '伺服器', val: percentile.serverPercentile, desc: p.serverName },
            { label: '職業', val: percentile.classPercentile, desc: p.className },
            { label: '全體', val: percentile.allDataPercentile, desc: '全體玩家' },
        ].filter(i => i.val != null && !isNaN(parseFloat(i.val)));

        if (ptItems.length > 0) {
            percentileHtml = `
                <div style="border-top: 1px solid rgba(255,255,255,0.06); padding: 10px 12px;">
                    <div style="font-size: 11px; color: #ecde15ff; margin-bottom: 8px; font-weight: 600; letter-spacing: 1px;">百分位</div>
                    ${ptItems.map(i => {
                const v = parseFloat(i.val);
                const barLen = Math.max(5, 100 - v);
                const color = v <= 5 ? '#ff6c6c' : v <= 20 ? '#ffd93d' : '#74b9ff';
                return `<div style="margin-bottom: 8px;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                                <span style="font-size:12px; color:#8b949e;">${i.label}</span>
                                <span style="font-size:12px; color:${color}; font-weight:800;">前 ${v}%</span>
                            </div>
                            <div style="height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow:hidden;">
                                <div style="width:${barLen}%; height:100%; background:${color}; border-radius:2px;"></div>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            `;
        }
    }

    let abyssRankName = "--";
    let abyssGradeId = 0;
    let abyssGradeIcon = "";
    const abyssRanking = (data.ranking && data.ranking.rankingList) ? data.ranking.rankingList.find(r => {
        const rType = r.rankingType || r.rankingContentsName || "";
        return r.rankingContentsType === 1 || String(rType).includes('Abyss') || String(rType).includes('總體') || String(rType).includes('深淵');
    }) : null;

    if (abyssRanking) {
        if (abyssRanking.gradeName) abyssRankName = abyssRanking.gradeName;
        abyssGradeId = abyssRanking.gradeId || 0;
        abyssGradeIcon = abyssRanking.gradeIcon || "";
    }

    const guildName = (data.ranking && data.ranking.rankingList) ? (data.ranking.rankingList.find(r => r.guildName)?.guildName || "無公會") : "無公會";

    let rankColor = "#fff";
    if (abyssGradeId >= 1 && abyssGradeId <= 10) rankColor = "#ff4d4d";
    else if (abyssGradeId >= 11 && abyssGradeId <= 13) rankColor = "#f1c40f";
    else if (abyssGradeId >= 14 && abyssGradeId <= 18) rankColor = "#ffffff";
    // Fallback if gradeId not found but name matches (legacy support)
    else if (abyssRankName.includes("軍官")) rankColor = "#f1c40f";
    else if (abyssRankName.includes("將軍") || abyssRankName.includes("司令官") || abyssRankName.includes("軍長") || abyssRankName.includes("大將")) rankColor = "#ff4d4d";

    const equipMap = {};
    (data.itemDetails || []).forEach(item => { equipMap[item.slotPos] = item; });
    if (data.equipment && data.equipment.equipmentList) {
        data.equipment.equipmentList.forEach(item => { if (!equipMap[item.slotPos]) equipMap[item.slotPos] = item; });
    }
    if (data.petwing && data.petwing.wing && !equipMap[21]) {
        equipMap[21] = { detail: data.petwing.wing, enchantLevel: data.petwing.wing.enchantLevel || 0, icon: data.petwing.wing.icon, grade: data.petwing.wing.grade };
    }
    window.__EQUIP_MAP__ = equipMap;

    // --- 2. Build Sidebar ---
    let itemScoreColor = '#f8f9fa';
    if (itemLv >= 3500) itemScoreColor = '#ff4d4d';
    else if (itemLv >= 3000) itemScoreColor = '#f1c40f';
    else if (itemLv >= 2500) itemScoreColor = '#00d4ff';
    else if (itemLv >= 2000) itemScoreColor = '#2ecc71';

    if (sidebar) {
        sidebar.innerHTML = `
            <div class="character-avatar-frame">
                <img class="avatar-img" src="${pImg}">
                <div class="lv-badge">Lv.${p.characterLevel || "--"}</div>
            </div>
            
            <div class="score-luxury-card gold" style="width: 100%; text-align: center; border-left: none; border-bottom: 4px solid #f1c40f; background: rgba(0,0,0,0.4); margin-top: 10px; min-height: fit-content;">
                <div class="card-bg-glow"></div>
                <div class="card-header" style="justify-content: center; font-size: 18px; color: ${itemScoreColor}; font-weight: 900; letter-spacing: 1px;">
                    <span class="icon">🏆</span> ${itemLv.toLocaleString()}
                </div>
                <div class="card-value" style="font-size: 22px; font-weight: 800; color: ${rankColor}; text-shadow: 0 0 10px ${rankColor}33; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    ${abyssGradeIcon ? `<img src="${getCorrectIcon(abyssGradeIcon)}" style="width:24px; height:24px;"><span>${abyssRankName}</span>` : '<span>--</span>'}
                </div>
            </div>

            <div class="layout-meta-tags" style="width: 100%; margin-top: 5px;">
                <div class="meta-tag-btn">${p.serverName} | ${guildName}</div>
                <div class="meta-tag-btn"><span class="icon">${(getLocalClassIcon(p.className) || p.classIcon) ? `<img src="${getLocalClassIcon(p.className) || getCorrectIcon(p.classIcon)}" style="width:25px; height:25px; vertical-align: middle; margin-right: 2px;">` : '⚔️'}</span> ${p.className}</div>
                ${p.titleName ? `<div class="meta-tag-btn" style="color:#ffd93d;"><span class="icon">✨</span> ${p.titleName}</div>` : ''}
            </div>

            <div class="ranking-summary-box" style="width: 100%; margin-top: auto; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05);">
                <div class="ranking-item" style="border:none; padding: 5px 0;">
                    <span class="label">PVE</span>
                    <span class="value" style="font-family: monospace; font-size: 16px; color: ${pveScore >= 50000 ? '#a855f7' : pveScore >= 40000 ? '#ef4444' : pveScore >= 30000 ? '#ffd700' : pveScore >= 20000 ? '#3498db' : pveScore >= 10000 ? '#2ecc71' : '#f8f9fa'}; text-shadow: 0 0 8px ${pveScore >= 30000 ? (pveScore >= 50000 ? '#a855f755' : pveScore >= 40000 ? '#ef444455' : '#ffd70055') : (pveScore >= 20000 ? '#3498db55' : (pveScore >= 10000 ? '#2ecc7155' : 'none'))}; font-weight: ${pveScore >= 10000 ? '900' : '400'};">${Math.floor(pveScore).toLocaleString()}</span>
                </div>
                <div class="ranking-item" style="border:none; padding: 5px 0;">
                    <span class="label">PVP</span>
                    <span class="value" style="font-family: monospace; font-size: ${pvpScore > 0 ? '16px' : '12px'}; color: ${pvpScore >= 50000 ? '#a855f7' : pvpScore >= 40000 ? '#ef4444' : pvpScore >= 30000 ? '#ffd700' : pvpScore >= 20000 ? '#3498db' : pvpScore >= 10000 ? '#2ecc71' : (pvpScore > 0 ? '#a855f7' : '#555')}; text-shadow: ${pvpScore >= 10000 ? '0 0 8px currentColor' : 'none'}; font-weight: ${pvpScore >= 10000 ? '900' : '400'}; font-style: ${pvpScore > 0 ? 'normal' : 'italic'}">${pvpScore > 0 ? Math.floor(pvpScore).toLocaleString() : '尚未有紀錄資料'}</span>
                </div>
            </div>
        `;
    }

    // --- Header Update ---
    const headerTitle = document.getElementById('integrated-header-title');
    if (headerTitle) {
        headerTitle.textContent = `${p.characterName || ""} 基本資料`;
    }

    // --- 3. Build Guardian Force (Middle Column) ---
    const boardNames = { nezakan: '奈薩肯', zikel: '吉凱爾', baizel: '白傑爾', triniel: '崔妮爾', malkutan: '瑪爾庫坦', ariel: '艾瑞爾', asphel: '阿斯佩爾' };
    const boardList = data.daevanionBoardList || (data.daevanionBoard && data.daevanionBoard.daevanionBoardList) || [];
    const guardianListHtml = Object.keys(boardNames).map(key => {
        const board = boardList.find(b => String(b.name).toLowerCase().includes(key) || boardNames[key] === b.name);

        let count = 0, total = 0;
        if (board) {
            count = board.openNodeCount || 0;
            total = board.totalNodeCount || 0;
            if (total === 0 && board.detail) {
                count = board.detail.openStatEffectList?.length || 0;
                total = board.detail.totalStatEffectCount || 0;
            }
        }
        if (total === 0) total = 152;

        const percent = total > 0 ? (count / total * 100) : 0;
        const isCompleted = count >= total && total > 0;

        return `
            <div style="background: rgba(10, 10, 15, 0.3); padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; backdrop-filter: blur(4px);">
                <div style="width: 80px; font-size: 13px; font-weight: bold; color: rgba(255, 255, 255, 0.85); letter-spacing: 0.5px;">
                    ${boardNames[key]}
                </div>
                <div style="flex: 1; margin: 0 15px; position: relative;">
                    <div style="width: 100%; height: 14px; background: rgba(0,0,0,0.5); border-radius: 4px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; display: flex; position: relative;">
                        <div style="position: absolute; left: 0; width: 2px; background: rgba(255,255,255,0.3); top:0; bottom:0; z-index: 1;"></div>
                        <div style="position: absolute; left: 50%; width: 1px; background: rgba(255,255,255,0.15); top:4px; bottom:4px; z-index: 1;"></div>
                        <div style="position: absolute; right: 0; width: 2px; background: rgba(255,255,255,0.3); top:0; bottom:0; z-index: 1;"></div>
                        <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, rgba(241,196,15,0.1) 0%, rgba(241,196,15,0.4) 100%); border-right: 2px solid #f1c40f; position: relative; z-index: 2;"></div>
                    </div>
                </div>
                <div style="text-align: right; min-width: 85px; display: flex; justify-content: flex-end;">
                    ${isCompleted ?
                `<span style="background: rgba(58, 28, 29, 0.9); border: 1px solid #ff5c5c; color: #ff7b7b; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; text-shadow: 0 0 2px rgba(255,123,123,0.5);">完成度 100%</span>` :
                `<span style="font-size: 14px; font-weight: 800; color: #fff;">${count}</span><span style="font-size: 11px; color: rgba(255,255,255,0.3); margin-left:2px;">/${total}</span>`
            }
                </div>
            </div>
        `;
    }).join('');

    // --- 4. Build Activity Rankings (Right Column) ---
    const rankingTypeMapping = { 1: '深淵', 3: '惡夢', 4: '超越', 5: '孤獨競技場', 6: '協力競技場', 20: '討伐戰', 21: '覺醒戰' };
    const rList = data.ranking?.rankingList || [];
    const rankingRowsHtml = Object.keys(rankingTypeMapping).map(typeId => {
        const r = rList.find(item => item.rankingContentsType == typeId);
        const rankVal = (r && r.rank != null) ? r.rank : '-';

        let change = r ? (r.rankChange || 0) : 0;
        if (change === 0 && r && r.rank != null && r.prevRank != null) {
            change = r.prevRank - r.rank;
        }

        let changeIcon = '<span class="change-icon change-none" style="opacity:0.2;">◈</span>';
        if (change > 0) changeIcon = '<span class="change-icon change-up" style="color:#ff4d4d; text-shadow: 0 0 5px rgba(255,77,77,0.3);">▲</span>';
        else if (change < 0) changeIcon = '<span class="change-icon change-down" style="color:#3498db; text-shadow: 0 0 5px rgba(52,152,219,0.3);">▼</span>';

        return `
            <div class="rank-row" style="background: rgba(40, 45, 60, 0.1); border-bottom: 1px solid rgba(255,255,255,0.03); padding: 6px 10px;">
                <span class="label" style="color: #8b949e; font-size: 13px;">${rankingTypeMapping[typeId]}</span>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="value" style="color: #fff; font-weight: 900; font-size: 15px;">
                        <span style="color: #f1c40f; opacity: 0.5; margin-right: 2px;">#</span>
                        <span style="color: #fff;">${rankVal}</span>
                    </span>
                    ${changeIcon}
                </div>
            </div>
        `;
    }).join('');

    // --- 5. Final Render ---
    if (container) {
        const leftSlots = [[1, 2], [3, 4], [5, 17], [6, 7], [21, 8]];
        const rightSlots = [[10, 15], [11, 12], [13, 14], [16, 23], [24, 22]];
        const generateSlotBtn = (item, slotId) => {
            if (!item) return `<div class="slot-item empty"></div>`;
            const d = item.detail || item;
            let icon = getCorrectIcon(item.icon || d.icon);
            const exceedLv = item.exceedLevel || d.exceedLevel || 0;
            const hasExceed = exceedLv > 0;

            // 強化等級：有突破時文字改橘紅色
            const enchant = (item.enchantLevel > 0)
                ? `<div class="slot-enchant ${hasExceed ? 'slot-enchant-exceeded' : ''}">+${item.enchantLevel}</div>`
                : "";

            // 突破等級徽章（右上角）
            const exceedBadge = hasExceed
                ? `<div class="slot-exceed">+${exceedLv}</div>`
                : "";

            // 使用 getEquipmentRarityInfo 統一判斷品階（包含名稱關鍵字修正）
            const slotRarityKeyMap = { 'mythic': 'myth', 'legendary': 'unique', 'epic': 'legend', 'special': 'special', 'rare': 'rare', 'common': 'common' };
            const slotRarityInfo = (typeof getEquipmentRarityInfo === 'function') ? getEquipmentRarityInfo(item) : null;
            let rc = slotRarityInfo ? (slotRarityKeyMap[slotRarityInfo.rarityKey] || 'common') : 'common';

            // 有突破加上 slot-item-exceeded class，套用紅色外框光暈
            return `<div class="slot-item slot-rarity-${rc}${hasExceed ? ' slot-item-exceeded' : ''}" onclick="window.handleSlotClick(event, ${slotId})" onmouseenter="window.handleSlotHover(event, ${slotId})" onmouseleave="window.handleSlotLeave()">
                <div class="slot-corner"></div><img src="${icon}" onerror="this.src='https://questlog.gg/assets/Game/UI/Resource/Texture/Common/Icon/Icon_Default.png'">${enchant}${exceedBadge}</div>`;
        };


        container.innerHTML = `
        <div style="position: relative; padding-bottom: 20px;">
            <div class="visual-layout-pure-grid" style="padding-top: 10px;">
                <div class="equip-grid-column">
                    <div style="display: flex; gap: 15px;">
                        <div style="display: grid; grid-template-columns: repeat(2, 68px); grid-gap: 12px;">
                            <div style="grid-column: span 2; text-align: center; opacity:0.3; font-size:18px;">⚔️</div>
                            ${leftSlots.flat().map(id => generateSlotBtn(equipMap[id], id)).join('')}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(2, 68px); grid-gap: 12px;">
                            <div style="grid-column: span 2; text-align: center; opacity:0.3; font-size:18px;">📿</div>
                            ${rightSlots.flat().map(id => generateSlotBtn(equipMap[id], id)).join('')}
                        </div>
                    </div>
                </div>

                <div class="guardian-force-column" style="flex: 1.2; min-width: 320px; background: rgba(20, 20, 30, 0.4); border-radius: 12px; padding: 12px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="text-align: center; margin-bottom: 12px; font-weight: 800; color: #ffd93d; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px;">
                         守護力
                    </div>
                    <div class="guardian-list-container">
                        ${guardianListHtml}
                    </div>
                </div>

                <div class="ranking-data-column" style="flex: 1; min-width: 220px; background: rgba(20, 20, 30, 0.4); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column;">
                    <div style="text-align: center; padding: 10px; font-weight: 800; color: #ffd93d; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">
                        排名
                    </div>
                    ${rankingRowsHtml}
                    ${percentileHtml}
                </div>
            </div>
            <div style="position: absolute; bottom: -5px; right: 0; font-size: 14px; color: rgba(139, 148, 158, 0.5); letter-spacing: 0.5px;">
                數據同步：${new Date(window.__LAST_UPDATE_TIME__ || Date.now()).toLocaleTimeString()}
            </div>
        </div>
        `;
    }

};






// --- 📸 截圖保存功能 ---
window.downloadEquipScreenshot = function (mode = 'simple') {
    const tabArea = document.getElementById('integrated-tab-content-area');
    if (!tabArea || !window.html2canvas) {
        alert("截圖組件尚未載入，請稍候再試。");
        return;
    }

    const btnId = mode === 'simple' ? 'btn-equip-screenshot-simple' : 'btn-equip-screenshot-detail';
    const btn = document.getElementById(btnId) || document.getElementById('btn-equip-screenshot');
    const originalText = btn ? btn.innerHTML : "📸 一鍵截圖";
    if (btn) {
        btn.innerHTML = "⏳ 正在製作截圖...";
        btn.style.pointerEvents = "none";
    }

    const charName = document.getElementById('stat-header-char-id')?.innerText || 'AionPlayer';
    const activeTab = document.querySelector('.integrated-tabs .stat-tab-btn.active')?.innerText || '裝備資料';

    // 延遲 500ms 給予資源一些加載時間
    setTimeout(() => {
        window.html2canvas(tabArea, {
            backgroundColor: '#0f172a',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: false,
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
            imageTimeout: 15000,
            onclone: (clonedDoc) => {
                const clonedArea = clonedDoc.getElementById('integrated-tab-content-area');
                if (clonedArea) {
                    // 1. 注入強制網頁版排版樣式
                    const desktopForceStyle = clonedDoc.createElement('style');
                    desktopForceStyle.innerHTML = `
                        #integrated-tab-content-area { 
                            width: 1200px !important; 
                            min-width: 1200px !important;
                            padding: 30px !important; 
                            display: block !important;
                            background: #0f172a !important;
                            height: auto !important;
                            max-height: none !important;
                            overflow: visible !important;
                        }
                        .grid-box-container, #equip-armor-list, #equip-accessory-list, 
                        #equip-armor-list-simple, #equip-accessory-list-simple { 
                            display: grid !important; 
                            grid-template-columns: repeat(3, 1fr) !important; 
                            gap: 15px !important;
                            width: 1140px !important;
                            margin: 0 auto !important;
                        }
                        .visual-layout-pure-grid {
                            display: flex !important;
                            flex-direction: row !important;
                            gap: 20px !important;
                            width: 1140px !important;
                            margin: 0 auto !important;
                        }
                        .equip-grid-column { flex: 1.5 !important; }
                        .guardian-force-column { flex: 1.2 !important; }
                        .ranking-data-column { flex: 1 !important; }
                        
                        /* 隱藏截圖按鈕本身 */
                        #btn-equip-screenshot-simple, #btn-equip-screenshot-detail, #btn-equip-screenshot {
                            display: none !important;
                        }
                        /* 確保在平板/手機上也是強迫 3 欄 */
                        @media screen {
                            .grid-box-container, .stat-grid-main { grid-template-columns: repeat(3, 1fr) !important; }
                        }
                    `;
                    clonedDoc.head.appendChild(desktopForceStyle);

                    clonedArea.style.display = 'block';

                    // 2. 切換正確的分頁顯示
                    const simpleTab = clonedDoc.getElementById('equip-tab-simple');
                    const detailTab = clonedDoc.getElementById('equip-tab-detail');
                    if (mode === 'simple') {
                        if (simpleTab) simpleTab.style.display = 'block';
                        if (detailTab) detailTab.style.display = 'none';
                    } else if (mode === 'detail') {
                        if (simpleTab) simpleTab.style.display = 'none';
                        if (detailTab) detailTab.style.display = 'block';
                    }

                    // 3. 建立頂部橫幅 (Banner)
                    const json = window.__LAST_DATA_JSON__ || {};
                    const dataObj = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
                    const profile = dataObj.profile || {};
                    const cName = profile.characterName || document.getElementById('stat-header-char-id')?.innerText || 'AionPlayer';
                    const cScore = document.getElementById('stat-header-score')?.innerText || '--';
                    let rawLevel = profile.characterLevel || document.querySelector('.profile-lv-badge')?.innerText?.replace('Lv.', '') || '--';
                    const cLv = `Lv.${rawLevel}`;
                    let rawImg = profile.profileImage || document.querySelector('.profile-img-lg')?.src || '';
                    const cImg = getCorrectIcon(rawImg);
                    const cServer = profile.serverName || document.querySelector('.profile-server')?.innerText || '';
                    const cClass = profile.className || document.querySelector('.profile-job-name')?.innerText || '';

                    const banner = clonedDoc.createElement('div');
                    banner.style.cssText = `
                        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                        padding: 30px;
                        border-radius: 12px;
                        margin-bottom: 30px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border: 1px solid rgba(255,215,0,0.3);
                        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                        width: 100%;
                        box-sizing: border-box;
                        color: white;
                    `;
                    banner.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 25px;">
                            <div class="character-avatar-frame" style="position: relative; width: 95px; height: 95px; flex-shrink: 0;">
                                <img class="avatar-img" src="${cImg}" style="width: 100%; height: 100%; border-radius: 50%; border: 4px solid #ffd700; object-fit: cover; background: #000; box-shadow: 0 0 20px rgba(255,215,0,0.3);">
                                <div class="lv-badge" style="position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); background: #ffd700; color: #000; padding: 2px 14px; border-radius: 20px; font-size: 15px; font-weight: 900; border: 2px solid #fff; white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">${cLv}</div>
                            </div>
                            <div>
                                <div style="font-size: 42px; font-weight: 900; color: #fff; line-height: 1.1; text-shadow: 0 2px 10px rgba(0,0,0,0.8);">${cName}</div>
                                <div style="font-size: 18px; color: rgba(255,255,255,0.7); margin-top: 8px; font-weight: 500; letter-spacing: 0.5px;">
                                    ${cServer} | ${cClass} 裝備數據分析報告
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 14px; color: #ffd700; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px; opacity: 0.8;">裝備評分</div>
                            <div style="font-size: 48px; font-weight: 950; color: #fff; text-shadow: 0 0 20px rgba(255,215,0,0.6); line-height: 1;">${cScore}</div>
                        </div>
                    `;
                    clonedArea.prepend(banner);
                }
            }
        }).then(canvas => {
            const fileName = `Aion2_${charName}_${activeTab}_${new Date().toLocaleDateString()}.jpg`;
            window.showScreenshotResult(canvas, fileName);
            if (btn) {
                btn.innerHTML = originalText;
                btn.style.pointerEvents = "auto";
            }
        }).catch(err => {
            console.error("Screenshot failed:", err);
            if (btn) btn.innerHTML = "❌ 截圖失敗";
            setTimeout(() => {
                if (btn) {
                    btn.innerHTML = originalText;
                    btn.style.pointerEvents = "auto";
                }
            }, 2000);
            const msg = (err && err.message) ? err.message : err;
            alert("截圖失敗: " + msg + "\\n(可能是頁面過大或圖片載入問題)");
        });
    }, 500);
};

// --- 📸 針對特定區域截圖保存功能 ---
window.downloadSpecificScreenshot = function (elementId, typeName) {
    const target = document.getElementById(elementId);
    if (!target || !window.html2canvas) return;

    const charName = document.getElementById('stat-header-char-id')?.innerText || 'AionPlayer';

    window.html2canvas(target, {
        backgroundColor: '#0f172a',
        scale: 2,
        logging: false,
        useCORS: true,
        scrollX: 0,
        scrollY: -window.scrollY,
        onclone: (clonedDoc) => {
            const clonedTarget = clonedDoc.getElementById(elementId);
            if (clonedTarget) {
                // 強制截圖模式為網頁排版
                const desktopForceStyle = clonedDoc.createElement('style');
                desktopForceStyle.innerHTML = `
                    #${elementId} { 
                        width: 1200px !important; 
                        padding: 30px !important; 
                        background: #0f172a !important;
                        display: block !important;
                    }
                    .grid-box-container, .stat-grid-main, #combat-stats-grid, #arcana-grid { 
                        display: grid !important; 
                        grid-template-columns: repeat(3, 1fr) !important; 
                        gap: 20px !important;
                    }
                    .health-main-stats-wrapper {
                        display: flex !important;
                        flex-direction: row !important;
                        gap: 15px !important;
                    }
                    .card { flex: 1 !important; }
                    /* 解決手機版 1 column 問題 */
                    @media screen {
                        * { grid-template-columns: repeat(3, 1fr) !important; }
                    }
                `;
                clonedDoc.head.appendChild(desktopForceStyle);
            }
        }
    }).then(canvas => {
        const fileName = `Aion2_${charName}_${typeName}_${new Date().toLocaleDateString()}.jpg`;
        window.showScreenshotResult(canvas, fileName);
    });
};

// --- 📸 顯示截圖結果彈窗 (解決行動裝置下載問題) ---
window.showScreenshotResult = function (canvas, fileName) {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 1024;

    // 如果是電腦版，且不是 iOS 設備，可以嘗試直接下載
    if (!isMobile && !/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        try {
            const link = document.createElement('a');
            link.download = fileName;
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            link.click();
            return;
        } catch (e) {
            console.warn("Direct download failed, showing modal instead.");
        }
    }

    // 建立或獲取彈窗 HTML
    let overlay = document.getElementById('screenshot-result-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'screenshot-result-overlay';
        overlay.className = 'screenshot-result-overlay';
        overlay.innerHTML = `
            <div class="screenshot-result-container">
                <div class="screenshot-result-header">
                    <span class="screenshot-result-title">📸 截圖製作完成</span>
                    <span class="screenshot-result-close" onclick="document.getElementById('screenshot-result-overlay').style.display='none'">×</span>
                </div>
                <div class="screenshot-result-body">
                    <img id="screenshot-result-img" class="screenshot-result-img">
                </div>
                <div class="screenshot-result-footer">
                    <div class="screenshot-instruction">手機用戶請「長按圖片」選擇儲存</div>
                   
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    const img = document.getElementById('screenshot-result-img');
    const downloadBtn = document.getElementById('screenshot-download-btn');

    let dataUrl = "";
    try {
        dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    } catch (e) {
        console.error("toDataURL Error:", e);
        alert("圖片產生失敗: " + e.message + "\\n(可能是安全限制或記憶體不足，請嘗試縮小視窗)");
        return;
    }

    if (img) img.src = dataUrl;
    if (overlay) overlay.style.display = 'flex';

    if (downloadBtn) {
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = fileName;
            link.href = dataUrl;
            link.click();
        };
    }
};


// --- Tooltip Functions ---
let tooltipHideTimer = null;

const getIsMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 1024;

window.handleSlotClick = function (e, slotId) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    //不分手機或網頁，點擊都顯示固定式彈窗（Modal）以便閱讀長資訊
    window.showEquipTooltip(slotId, 'modal', e);
};

window.handleSlotHover = function (e, slotId) {
    if (!getIsMobile()) {
        if (tooltipHideTimer) {
            clearTimeout(tooltipHideTimer);
            tooltipHideTimer = null;
        }
        window.showEquipTooltip(slotId, 'hover', e);
    }
};

window.handleSlotLeave = function () {
    if (!getIsMobile()) {
        // 增加 200ms 延遲，讓滑鼠有機會移入 Tooltip 內而不消失
        tooltipHideTimer = setTimeout(() => {
            const overlay = document.getElementById('equip-tooltip-overlay');
            const content = document.getElementById('equip-tooltip-content');
            if (content && content.classList.contains('is-hover')) {
                overlay.style.display = 'none';
            }
        }, 200);
    }
};

window.handleSkillHover = function (el, e) {
    if (!getIsMobile()) {
        window.showSkillHoverTooltip(el, e, 'hover');
    }
};

window.handleSkillLeave = function (e) {
    if (!getIsMobile()) {
        window.closeEquipTooltip(e);
    }
};

window.handleSkillClick = function (el, e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    window.showSkillHoverTooltip(el, e, 'modal');
};

window.showEquipTooltip = function (slotId, mode = 'modal', event = null) {
    if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
    }

    const item = (window.__EQUIP_MAP__ || {})[slotId];
    if (!item) return;

    const overlay = document.getElementById('equip-tooltip-overlay');
    const content = document.getElementById('equip-tooltip-content');
    if (!overlay || !content) return;

    if (mode === 'hover') {
        content.onmouseenter = () => { if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; } };
        content.onmouseleave = () => { window.handleSlotLeave(); };
    }

    const d = item.detail || item;
    const name = d.name || '未知裝備';
    const icon = getCorrectIcon(item.icon || d.icon);

    const tooltipRarityKeyMap = { 'mythic': 'myth', 'legendary': 'unique', 'epic': 'legend', 'special': 'special', 'rare': 'rare', 'common': 'common' };
    const tooltipRarityInfo = (typeof getEquipmentRarityInfo === 'function') ? getEquipmentRarityInfo(item) : null;
    let rarityClass = tooltipRarityInfo ? (tooltipRarityKeyMap[tooltipRarityInfo.rarityKey] || 'common') : 'common';
    let gradeName = tooltipRarityInfo ? tooltipRarityInfo.name : '一般';
    let gradeColor = tooltipRarityInfo ? tooltipRarityInfo.color : '#fff';

    let mainStatsHtml = '';
    if (d.mainStats && d.mainStats.length > 0) {
        mainStatsHtml = `
            <div class="tooltip-section">
                <div class="tooltip-section-title">主要能力值</div>
                ${d.mainStats.map(s => {
            const extraVal = (s.extra && parseFloat(s.extra) !== 0) ? s.extra.toString().replace('+', '') : null;
            const baseValNum = parseFloat(s.value) || 0;
            const minVal = s.minValue ? parseFloat(s.minValue) : null;
            const baseDisplay = (minVal && minVal > 0)
                ? `<span class="val-base">${minVal}</span><span style="color:#555;"> ~ </span><span class="val-base">${s.value}</span>`
                : `<span class="val-base">${s.value}</span>`;

            if (baseValNum === 0 && !minVal && extraVal) {
                return `
                            <div class="stat-row">
                                <span class="stat-label ${s.exceed ? 'val-orange' : ''}">${s.name}</span>
                                <div class="stat-leader"></div>
                                <span class="stat-value ${s.exceed ? 'val-orange' : 'val-bonus'}">+${extraVal}</span>
                            </div>
                        `;
            }
            return `
                        <div class="stat-row">
                            <span class="stat-label ${s.exceed ? 'val-orange' : ''}">${s.name}</span>
                            <div class="stat-leader"></div>
                            <span class="stat-value">
                                ${baseDisplay}
                                ${extraVal ? `<span class="${s.exceed ? 'val-orange' : 'val-bonus'}"> (+${extraVal})</span>` : ''}
                            </span>
                        </div>
                    `;
        }).join('')}
            </div>`;
    }

    let subStatsHtml = '';
    const partKey = window.getPartKey ? window.getPartKey(item) : null;
    if (d.subStats && d.subStats.length > 0) {
        subStatsHtml = `
            <div class="tooltip-section">
                <div class="tooltip-section-title">隨機能力值</div>
                ${d.subStats.map(s => {
            const displayVal = (s.value || "").toString().startsWith('+') ? s.value : `+${s.value}`;
            const topInfo = window.getTop10Info(false, s.name, s.value, partKey);
            const exceed = s.exceed || false;
            const badge = exceed ? `<span style="background:#f1c40f; color:#000; padding:1px 3px; border-radius:3px; font-size:9px; font-weight:900; margin-left:4px;">TOP</span>` : '';
            return `
                        <div class="stat-row">
                            <span class="stat-label val-green">${s.name}</span>
                            <div class="stat-leader"></div>
                            <span class="stat-value val-green">${displayVal}${badge}</span>
                        </div>
                    `;
        }).join('')}
            </div>`;
    }

    let stonesHtml = '';
    if (d.magicStoneStat && d.magicStoneStat.length > 0) {
        stonesHtml = `
            <div class="tooltip-section">
                <div class="tooltip-section-title">魔石槽位</div>
                <div class="magic-stone-list">
                    ${d.magicStoneStat.map(s => {
            const cleanName = (s.name || "").split('+')[0].trim();
            const displayVal = (s.value || "").toString().startsWith('+') ? s.value : `+${s.value}`;
            const topInfo = window.getTop10Info(true, s.name, s.value, partKey);
            const gColor = getGradeColor(s.grade || 'common');
            const color = topInfo.color || gColor;
            return `
                            <div class="stone-item">
                                <img class="stone-icon" src="${s.icon}">
                                <div class="stone-text" style="color: ${color};">${cleanName} ${displayVal}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>`;
    }

    let godStoneHtml = '';
    if (d.godStoneStat && d.godStoneStat.length > 0) {
        godStoneHtml = `<div class="tooltip-section"><div class="tooltip-section-title">神石</div>${d.godStoneStat.map(gs => {
            const gsColor = getGradeColor(gs.grade || 'unique');
            return `<div style="border: 1px dashed ${gsColor}; padding:8px; font-size:12px; border-radius:6px; background:rgba(0,0,0,0.2); margin-top:5px;"><b style="color:${gsColor}">${gs.name}</b><div style="color:#adb5bd; margin-top:4px;">${gs.desc}</div></div>`;
        }).join('')}</div>`;
    }

    let skillsHtml = '';
    const itemSkills = [...(d.skills || []), ...(d.itemSkills || []), ...(d.extraSkills || [])];
    if (itemSkills.length > 0) {
        skillsHtml = `<div class="tooltip-section"><div class="tooltip-section-title">裝備技能</div>${itemSkills.map(s => {
            const sName = s.name || (typeof window.getSkillName === 'function' ? window.getSkillName(s.id) : s.id);
            return `<div class="stat-row"><span class="stat-label val-bonus">${sName}</span><div class="stat-leader"></div><span class="stat-value val-bonus">${s.level ? `Lv.${s.level}` : ''}</span></div>`;
        }).join('')}</div>`;
    }

    const sourceHtml = d.sources ? `<div class="tooltip-footer">來源: ${d.sources.join(', ')}</div>` : '';
    const exceedLv = item.exceedLevel || d.exceedLevel || 0;
    const exceedHtml = exceedLv > 0 ? `<span class="breakthrough-label">突破 +${exceedLv}</span>` : "";

    const isMobile = getIsMobile();
    content.className = `equip-tooltip tooltip-rarity-${rarityClass}`;

    // 只有在非移動端的 hover 模式下才讓 overlay 穿透
    if (mode === 'hover' && !isMobile) {
        content.classList.add('is-hover');
        overlay.style.background = 'transparent';
        overlay.style.backdropFilter = 'none';
        overlay.style.pointerEvents = 'none';
        overlay.style.display = 'block';
    } else {
        // Modal 模式或行動端：強制顯示遮罩
        content.classList.remove('is-hover');
        overlay.style.background = 'rgba(0, 0, 0, 0.75)';
        overlay.style.backdropFilter = 'blur(8px)';
        overlay.style.pointerEvents = 'auto'; // 必須為 auto 才能點擊
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'flex-start'; // 靠上對齊
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '60px 20px 20px 20px'; // 頂部留一點空間避開邊緣
        overlay.onclick = function (e) { if (e.target === overlay) window.closeEquipTooltip(); };
    }

    content.innerHTML = `
        <div class="close-tooltip-circle" onclick="window.closeEquipTooltip(event)">×</div>
        <div class="tooltip-header">
            <div class="tooltip-icon-frame"><img src="${icon}"></div>
            <div class="tooltip-title-area">
                <div class="tooltip-name">${item.enchantLevel > 0 ? `+${item.enchantLevel} ` : ''}${name}${exceedHtml}</div>
                <div class="tooltip-sub-info">
                    <span class="tooltip-grade-label" style="color:${gradeColor}">${gradeName}</span>
                    ${d.categoryName ? `<span>${d.categoryName}</span>` : ''}
                    <span>Lv.${d.level || d.equipLevel || 1}${d.levelValue ? ` (+${d.levelValue})` : ''}</span>
                </div>
            </div>
        </div>
        <div class="tooltip-body">
            ${mainStatsHtml}
            ${subStatsHtml}
            ${skillsHtml}
            ${godStoneHtml}
            ${stonesHtml}
        </div>
        ${sourceHtml}
    `;

    const isMobileUI = (mode === 'modal' || isMobile);

    if (mode === 'hover' && event && !isMobile) {
        let x = event.clientX + 30, y = event.clientY - 50;
        if (x + 350 > window.innerWidth) x = event.clientX - 360;
        content.style.position = 'fixed'; content.style.left = x + 'px'; content.style.top = y + 'px';
        content.style.transform = '';
        setTimeout(() => {
            const rect = content.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) content.style.top = (window.innerHeight - rect.height - 20) + 'px';
            if (rect.top < 0) content.style.top = '10px';
        }, 0);
    } else {
        // Modal 模式：重置所有定位樣式，交給 Overlay (Flexbox) 處理
        content.style.position = '';
        content.style.left = '';
        content.style.top = '';
        content.style.transform = '';
    }
};

window.closeEquipTooltip = function (e) {
    if (e && e.type === 'mouseout') {
        const content = document.getElementById('equip-tooltip-content');
        if (content && !content.classList.contains('is-hover')) {
            // 在 Modal 模式下忽略 mouseout
            return;
        }
    }

    if (e && typeof e.stopPropagation === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }
    const overlay = document.getElementById('equip-tooltip-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
    }
    if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
    }
};

window.soulbindNameMap = {
    "STR": "威力", "CombatSpeed": "戰鬥速度", "AmplifyWeaponDamage": "武器傷害增幅",
    "DEX": "敏捷", "AdditionalHitRate": "多段打擊擊中", "AmplifyAllDamage": "傷害增幅",
    "WeaponFixingDamage": "攻擊力", "Critical": "暴擊", "WIS": "意志", "INT": "知識",
    "Block": "格擋", "WeaponAccuracy": "命中", "AbnormalAccuracy": "異常狀態擊中",
    "CriticalAddDamage": "暴擊攻擊力", "HPMax": "生命力", "BackAttackDamage": "後方攻擊力",
    "CON": "體力", "AGI": "精確", "MPMax": "精神力", "Parry": "武器防禦", "Evasion": "迴避",
    "DefenseRatio": "防禦力增加", "CriticalResist": "暴擊抵抗", "HPRegen": "生命力自然恢復",
    "Restoration": "再生", "BackAttackDefense": "後方防禦力", "IronWall": "鐵壁",
    "HardHitResist": "強擊抵抗", "AbnormalResistance": "異常狀態抵抗", "CriticalDamageDefense": "暴擊防禦力",
    "ArmorDefense": "防禦力", "ArmorEvasion": "迴避", "ShockPropertyAccuracy": "衝擊系擊中",
    "HardHit": "強擊", "AmplifyHpHealGet": "所受治癒量", "DamageRatio": "攻擊力增加", "MPRegen": "精神力自然恢復",
    "AmplifyCriticalDamage": "暴擊傷害增幅", "DecreaseCriticalDamage": "暴擊傷害耐性", "DecreaseWeaponDamage": "武器傷害耐性", "IgnoreIronWall": "鐵壁貫穿", "DecreaseDamage": "傷害耐性", "MoveSpeed": "移動速度",
    "AmplifyHpHealSend": "治療量增加", "AmplifySkillDamage": "技能傷害增加", "AmplifyShield": "護盾量增加",
    "Destruction": "破壞[吉凱爾]", "Wisdom": "智慧[露梅爾]", "Time": "時間[希埃爾]",
    "Death": "死亡[崔妮爾]", "Illusion": "幻象[凱西內爾]", "Freedom": "自由[白傑爾]",
    "Life": "生命[尤斯迪埃]", "Space": "空間[伊斯拉佩爾]", "Destiny": "命運[瑪爾庫坦]", "Justice": "正義[奈薩肯]"
};

window.magicStoneMap = {
    "WeaponFixingDamage": "攻擊力", "Accuracy": "額外命中", "Critical": "暴擊",
    "HPMax": "生命力", "MPMax": "精神力", "ArmorDefense": "防禦力",
    "Evasion": "額外迴避", "CriticalResist": "暴擊抵抗", "Block": "格擋",
    "AmplifyWeaponDamage": "武器傷害增幅", "AmplifyAllDamage": "傷害增幅",
    "AmplifyCriticalDamage": "暴擊傷害增幅", "AmplifyBackAttack": "後方傷害增幅",
    "PvPAccuracy": "PVP命中", "PvPEvasion": "PVP迴避", "PvPAmplifyDamage": "PVP傷害增幅",
    "PvPAddDamage": "PVP攻擊力", "PvPCriticalResist": "PVP暴擊抵抗", "PvPCritical": "PVP暴擊",
    "PvPDamageDefense": "PVP防禦力",
    "Destruction": "破壞[吉凱爾]", "Wisdom": "智慧[露梅爾]", "Time": "時間[希埃爾]",
    "Death": "死亡[崔妮爾]", "Illusion": "幻象[凱西內爾]", "Freedom": "自由[白傑爾]",
    "Life": "生命[尤斯迪埃]", "Space": "空間[伊斯拉佩爾]", "Destiny": "命運[瑪爾庫坦]", "Justice": "正義[奈薩肯]"
};

// 嚴謹的詞條/魔石名稱比對函數，避免如「暴擊」錯誤匹配「暴擊傷害增幅」
window.isStatNameMatch = (statName, mappedName) => {
    if (!statName || !mappedName) return false;
    const simple = mappedName.replace('增加', '').replace('增幅', '').replace('力', '').replace('額外', '');

    if (statName === mappedName || statName === simple) return true;

    if (statName.includes(mappedName) || statName.includes(simple)) {
        // 例外排除：避免包含字眼造成的誤判
        if (mappedName === '暴擊' && statName !== '暴擊') return false;
        if (mappedName === '攻擊力' && statName !== '攻擊力') return false;
        if (['生命力', '精神力'].includes(mappedName) && statName !== mappedName) return false;
        if (mappedName === '命中' && !['命中', '額外命中', '物理命中'].includes(statName)) return false;
        if (mappedName === '迴避' && !['迴避', '額外迴避', '物理迴避'].includes(statName)) return false;

        return true;
    }

    return false;
};

window.getPartKey = (i) => {
    if (!i) return null;
    const name = (i.detail?.name || i.name || "").toLowerCase();
    const cat = (i.detail?.categoryName || i.categoryName || "").toLowerCase();
    const s = String(i.slotPos);

    if (['34', '35', '36', 'Bracelet', 'Bracelet1', 'Bracelet2'].includes(s) || cat.includes('手鐲') || name.includes('手鐲')) {
        if (s === '35' || s === '36' || name.includes('手鐲2') || name.includes('深淵手鐲')) return 'Bracelet2';
        return 'Bracelet';
    }

    if (cat.includes('武器') || name.includes('劍') || name.includes('弓') || name.includes('杖') || name.includes('書') || name.includes('珠')) return 'MainHand';
    if (cat.includes('盾') || cat.includes('臂甲') || name.includes('臂甲') || name.includes('盾')) return 'SubHand';
    if (cat.includes('頭盔') || cat.includes('頭飾') || name.includes('頭盔') || name.includes('頭飾')) return 'Helmet';
    if (name.includes('肩') || cat.includes('肩')) return 'Shoulder';
    if (name.includes('胸甲') || name.includes('上衣') || cat.includes('上衣')) return 'Torso';
    if (name.includes('腿甲') || name.includes('下衣') || cat.includes('下衣')) return 'Pants';
    if (name.includes('手套') || cat.includes('手套')) return 'Gloves';
    if (name.includes('鞋') || cat.includes('鞋')) return 'Boots';
    if (cat.includes('披風') || cat.includes('翅膀') || name.includes('披風') || name.includes('斗篷') || name.includes('翅')) return 'Cape';
    if (name.includes('項鍊') || cat === '項鍊') return 'Necklace';

    if (['11', 'Earring1'].includes(s)) return 'Earring1';
    if (['12', 'Earring2'].includes(s)) return 'Earring2';
    if (['14', 'Ring1'].includes(s)) return 'Ring1';
    if (['16', '15', 'Ring2'].includes(s)) return 'Ring2';

    if (cat === '耳環') return 'Earring';
    if (cat === '戒指') return 'Ring';

    // Slot ID Fallback
    if (['0', 'MainHand'].includes(s)) return 'MainHand';
    if (['1', 'SubHand'].includes(s)) return 'SubHand';
    if (['2', 'Helmet'].includes(s)) return 'Helmet';
    if (['3', 'Torso'].includes(s)) return 'Torso';
    if (['4', 'Pants'].includes(s)) return 'Pants';
    if (['5', 'Shoulder'].includes(s)) return 'Shoulder';
    if (['6', 'Gloves'].includes(s)) return 'Gloves';
    if (['7', 'Boots'].includes(s)) return 'Boots';
    if (['10', 'Cape', 'Wings'].includes(s)) return 'Cape';
    if (['13', 'Necklace'].includes(s)) return 'Necklace';

    return null;
};

window.getTop10Info = (isStone, statName, statValue, partKey, skills = []) => {
    if (typeof STATIC_STATS_DATA === 'undefined') return { color: null, badge: '' };
    const mode = window.currentStatPlaystyle || 'PVE';

    let distKey = partKey;
    if (distKey?.startsWith('Earring')) distKey = 'Earring';
    if (distKey?.startsWith('Ring')) distKey = 'Ring';
    if (distKey?.startsWith('Bracelet')) distKey = 'Bracelet';

    let top10List = [];
    if (isStone) {
        const isAccessory = ['Cape', 'Necklace', 'Earring1', 'Earring2', 'Ring1', 'Ring2', 'Bracelet', 'Bracelet2'].includes(partKey);
        const groupKey = isAccessory ? 'accessory' : 'gear';
        top10List = STATIC_STATS_DATA[`MagicStone_${mode}_${groupKey}`] || [];
    } else {
        top10List = STATIC_STATS_DATA[distKey + '_' + mode] || [];
    }

    let isMatch = false;
    let isExceed = false;
    const cleanUserVal = parseFloat(statValue) || 0;

    const dictionary = isStone ? window.magicStoneMap : window.soulbindNameMap;

    top10List.forEach(t => {
        let mappedName = dictionary[t.statKey] || t.statKey;
        if (!isStone && !dictionary[t.statKey] && /^\d+$/.test(t.statKey) && typeof window.getSkillName === 'function') {
            mappedName = window.getSkillName(t.statKey);
        }

        const topVal = parseFloat(t.value) || 0;
        const nameMatch = window.isStatNameMatch(statName, mappedName);

        if (nameMatch) {
            if (isStone) {
                if (cleanUserVal === topVal) isMatch = true;
                if (cleanUserVal > topVal) isExceed = true;
            } else {
                isMatch = true;
            }
        }
    });

    if (!isStone && skills.length > 0) {
        skills.forEach(s => {
            const sName = s.name || (typeof window.getSkillName === 'function' ? window.getSkillName(s.id) : s.id);
            top10List.forEach(t => {
                let mappedName = window.soulbindNameMap[t.statKey] || t.statKey;
                if (window.isStatNameMatch(sName, mappedName)) isMatch = true;
            });
        });
    }

    if (isStone) {
        // 魔石若有精準吻合，就不標記 UP!，保留給完全超越的顯示
        if (isMatch) return { color: null, badge: '' };
        if (isExceed) return { color: null, badge: 'UP!' };
        return { color: null, badge: '' };
    }

    if (isMatch) return { color: '#2ecc71', badge: '' };
    return { color: null, badge: '' };
};
window.renderStatsTab = async function (json, initialActiveKey = null) {
    // Set final target key from: 1. provided 2. global state 3. first available
    let activeKey = initialActiveKey || window.__CURRENT_STATS_TAB__;
    const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
    const container = document.getElementById('equip-tab-stats');
    if (!data || !container) return;

    if (typeof STATIC_STATS_DATA === 'undefined') {
        container.innerHTML = `<div style="padding:40px; text-align:center; color:#ff6b6b; font-size:14px;">大數據排行榜尚未載入完成...</div>`;
        return;
    }

    const items = data.itemDetails || [];

    const slotConfig = [
        { title: '武器', key: 'MainHand', match: i => window.getPartKey(i) === 'MainHand' },
        { title: '臂甲', key: 'SubHand', match: i => window.getPartKey(i) === 'SubHand' },
        { title: '頭盔', key: 'Helmet', match: i => window.getPartKey(i) === 'Helmet' },
        { title: '肩甲', key: 'Shoulder', match: i => window.getPartKey(i) === 'Shoulder' },
        { title: '胸甲', key: 'Torso', match: i => window.getPartKey(i) === 'Torso' },
        { title: '腿甲', key: 'Pants', match: i => window.getPartKey(i) === 'Pants' },
        { title: '手套', key: 'Gloves', match: i => window.getPartKey(i) === 'Gloves' },
        { title: '鞋子', key: 'Boots', match: i => window.getPartKey(i) === 'Boots' },
        { title: '披風', key: 'Cape', match: i => window.getPartKey(i) === 'Cape' },
        { title: '項鍊', key: 'Necklace', match: i => window.getPartKey(i) === 'Necklace' },
        { title: '耳環', key: 'Earring1', match: i => window.getPartKey(i)?.includes('Earring') },
        { title: '耳環2', key: 'Earring2', match: i => window.getPartKey(i)?.includes('Earring') },
        { title: '戒指1', key: 'Ring1', match: i => window.getPartKey(i)?.includes('Ring') },
        { title: '戒指2', key: 'Ring2', match: i => window.getPartKey(i)?.includes('Ring') },
        { title: '手鐲1', key: 'Bracelet', match: i => window.getPartKey(i)?.includes('Bracelet') },
        { title: '手鐲2', key: 'Bracelet2', match: i => window.getPartKey(i)?.includes('Bracelet') }
    ];

    const renderTop10List = (dist, dictionary, isStone, userItem) => {
        if (!dist || dist.length === 0) return `<div style="color:#777; padding:10px;">無數據</div>`;

        const d_user = (userItem && (userItem.detail || userItem)) || {};
        const userSubStats = Array.isArray(d_user.subStats) ? d_user.subStats : [];
        const userMagicStones = Array.isArray(d_user.magicStoneStat) ? d_user.magicStoneStat : [];

        // ===== 魔石預處理：排序配對 =====
        // topEntryResult[i] = { match: false, higher: false, gradeColor: null }
        const topEntryResult = {};
        if (isStone) {
            // 1. 收集使用者各類型魔石 { value, grade }，按 value 降序
            const userStonesByType = {}; // mappedName → [{ val, grade }, ...]
            userMagicStones.forEach(s => {
                if (!s || !s.name) return;
                const cleanSN = (s.name).split('+')[0].trim();
                const val = parseFloat(s.value) || 0;
                if (val <= 0) return;
                const grade = s.grade || 'common';
                Object.values(dictionary || {}).forEach(mName => {
                    if (!mName) return;
                    if (window.isStatNameMatch(cleanSN, mName)) {
                        if (!userStonesByType[mName]) userStonesByType[mName] = [];
                        // 避免同一顆魔石重複加入
                        if (!userStonesByType[mName].some(x => x.val === val && x.grade === grade)) {
                            userStonesByType[mName].push({ val, grade });
                        }
                    }
                });
            });
            // 排序：值高在前
            Object.values(userStonesByType).forEach(arr => arr.sort((a, b) => b.val - a.val));

            // 2. 收集 TOP 各類型條目的索引，按 value 降序
            const topEntriesByType = {}; // mappedName → [{ idx, val }, ...]
            dist.forEach((d, idx) => {
                if (!d) return;
                const mName = dictionary[d.statKey] || d.statKey;
                if (!topEntriesByType[mName]) topEntriesByType[mName] = [];
                topEntriesByType[mName].push({ idx, val: parseFloat(d.value) || 0 });
            });
            Object.values(topEntriesByType).forEach(arr => arr.sort((a, b) => b.val - a.val));

            // 3. 逐類型配對 (優先精確吻合，再判斷超越)
            Object.keys(topEntriesByType).forEach(mName => {
                const topArr = topEntriesByType[mName]; // TOP 條目（降序）
                const userArr = [...(userStonesByType[mName] || [])]; // 使用者魔石（降序）

                // 複製一份 TOP 等待配對，保留原始 idx
                let topLeft = [...topArr];
                let userLeft = [...userArr];

                // Pass 1: 精確吻合
                // 從高到低比對 TOP 項目，確認是否存在相同的 User 魔石
                for (let i = topLeft.length - 1; i >= 0; i--) {
                    const topEntry = topLeft[i];
                    const uIdx = userLeft.findIndex(u => u.val === topEntry.val);
                    if (uIdx !== -1) {
                        const u = userLeft.splice(uIdx, 1)[0];
                        const gc = (typeof getGradeColor === 'function') ? getGradeColor(u.grade) : '#fff';
                        topEntryResult[topEntry.idx] = { match: true, higher: false, gradeColor: gc };
                        topLeft.splice(i, 1);
                    }
                }

                // Pass 2: 超越配對 (UP!)
                // 從高到低檢查剩下未匹配的 TOP，找出可以「吃下(=大於)它」的最高 User 魔石
                topLeft.forEach(topEntry => {
                    const uIdx = userLeft.findIndex(u => u.val > topEntry.val);
                    if (uIdx !== -1) {
                        userLeft.splice(uIdx, 1);
                        topEntryResult[topEntry.idx] = { match: false, higher: true, gradeColor: null };
                    } else {
                        topEntryResult[topEntry.idx] = { match: false, higher: false, gradeColor: null };
                    }
                });
            });
        }

        return dist.map((d, i) => {
            if (!d || !d.statKey) return '';

            let mappedName = dictionary[d.statKey] || d.statKey;
            if (!dictionary[d.statKey] && /^\d+$/.test(d.statKey) && typeof window.getSkillName === 'function') {
                mappedName = window.getSkillName(d.statKey) || mappedName;
            }

            let isMatch = false;
            let isHigher = false;
            let matchGradeColor = null;

            if (isStone) {
                const result = topEntryResult[i];
                if (result) {
                    isMatch = result.match;
                    isHigher = result.higher;
                    matchGradeColor = result.gradeColor;
                }
            } else {
                const itemSkills = d_user.skills || d_user.itemSkills || d_user.extraSkills || [];

                isMatch = userSubStats.some(s => {
                    if (!s || !s.name) return false;
                    return window.isStatNameMatch(s.name, mappedName);
                }) || itemSkills.some(s => {
                    if (!s) return false;
                    const sName = s.name || (typeof window.getSkillName === 'function' ? window.getSkillName(s.id) : (s.id || ''));
                    return window.isStatNameMatch(sName, mappedName);
                });

                if (!isMatch) {
                    isHigher = userSubStats.some(s => {
                        if (!s || !s.name) return false;
                        return window.isStatNameMatch(s.name, mappedName) && s.exceed;
                    });
                }
            }

            const displayName = isStone ? `${mappedName} +${d.value}` : mappedName;

            // 魔石吻合→品階色；超越→UP!；詞條吻合→綠色
            let textColor = '#fff';
            let badgeHtml = '';

            if (isStone && isMatch && matchGradeColor) { textColor = matchGradeColor; }
            else if (!isStone && isMatch) { textColor = '#2ecc71'; }
            if (isHigher) { badgeHtml = `<span style="background:#f1c40f; color:#000; padding:1px 4px; border-radius:3px; font-size:10px; font-weight:900; margin-left:6px;">UP!</span>`; }

            const numColor = i < 3 ? '#ff9f43' : '#a4b0be';

            return `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.03); font-size:13px;">
                    <div style="display:flex; align-items:center;">
                        <div style="width:20px; color:${numColor}; font-weight:bold; font-style:italic;">${i + 1}</div>
                        <div style="color:${textColor}; font-weight:${(isMatch || isHigher) ? 'bold' : 'normal'};">${displayName}${badgeHtml}</div>
                    </div>
                    <div style="color:${textColor}; font-size:11px; font-weight:bold;">${d.percent.toFixed(1)}%</div>
                </div>
            `;
        }).join('');
    };

    const renderUserItem = (item, sbTop10, msTop10, conf) => {
        if (!item) return `<div style="padding:15px; color:#e74c3c;">未裝備物件</div>`;
        const d = item.detail || item;
        const msLabel = (conf.key.includes('Cape') || conf.key.includes('Necklace') || conf.key.includes('Earring') || conf.key.includes('Ring') || conf.key.includes('Bracelet')) ? '靈石' : '魔石';

        let sbHtml = '';
        const itemSkills = [
            ...(d.skills || []),
            ...(d.subSkills || []),
            ...(d.itemSkills || []),
            ...(d.extraSkills || [])
        ];
        const hasSb = d.subStats && d.subStats.length > 0;
        const hasSkills = itemSkills.length > 0;

        if (hasSb || hasSkills) {
            let sbLines = [];
            if (hasSb) {
                d.subStats.forEach(s => {
                    const isMatch = (sbTop10 || []).some(top => {
                        const mName = window.soulbindNameMap[top.statKey] || (typeof window.getSkillName === 'function' ? window.getSkillName(top.statKey) : top.statKey);
                        return window.isStatNameMatch(s.name, mName);
                    });
                    const isExceed = s.exceed || false;
                    // 超越時不改色，只加 badge
                    const color = isMatch ? '#2ecc71' : '#fff';
                    const badge = isExceed ? `<span style="background:#f1c40f; color:#000; padding:1px 3px; border-radius:2px; font-size:9px; font-weight:900; margin-left:4px;">TOP級</span>` : '';
                    const displayVal = (s.value || "").toString().startsWith('+') ? s.value : `+${s.value}`;
                    sbLines.push(`<div style="color:${color}; font-size:13px; margin-bottom:4px; font-weight:${isMatch ? 'bold' : 'normal'}">• ${s.name} <span style="font-weight:bold;">${displayVal}</span>${badge}</div>`);
                });
            }
            if (hasSkills) {
                itemSkills.forEach(s => {
                    const sName = s.name || (typeof window.getSkillName === 'function' ? window.getSkillName(s.id) : s.id);
                    const isMatch = (sbTop10 || []).some(top => {
                        const mName = window.soulbindNameMap[top.statKey] || (typeof window.getSkillName === 'function' ? window.getSkillName(top.statKey) : top.statKey);
                        return window.isStatNameMatch(sName, mName);
                    });
                    const color = isMatch ? '#2ecc71' : '#fff';
                    sbLines.push(`<div style="color:${color}; font-size:13px; margin-bottom:4px; font-weight:${isMatch ? 'bold' : 'normal'}">• ${sName} ${s.level ? `Lv.${s.level}` : ''}</div>`);
                });
            }
            sbHtml = sbLines.join('');
        } else {
            sbHtml = `<div style="color:#777; font-size:12px;">無詞條/技能</div>`;
        }

        let msHtml = '';
        if (d.magicStoneStat && d.magicStoneStat.length > 0) {
            msHtml = d.magicStoneStat.map(s => {
                const topInfo = window.getTop10Info(true, s.name, s.value, conf.key);
                // 使用品階色為基礎，匹配 TOP 時覆蓋成配對色
                const gColor = (typeof getGradeColor === 'function') ? getGradeColor(s.grade || 'unique') : '#fff';
                const color = topInfo.color || gColor;
                const cleanStoneName = (s.name || "").split('+')[0].trim();
                const displayVal = (s.value || "").toString().startsWith('+') ? s.value : `+${s.value}`;
                return `
                    <div style="color:${color}; font-size:13px; margin-bottom:4px; font-weight:${topInfo.color ? 'bold' : 'normal'}; display:flex; justify-content:space-between; align-items:center;">
                        <span>• ${cleanStoneName}</span>
                        <span style="font-weight:bold; margin-left:8px;">${displayVal}</span>
                    </div>`;
            }).join('');
        } else {
            msHtml = `<div style="color:#777; font-size:12px;">無${msLabel}</div>`;
        }

        return `
            <div style="background: rgba(15, 20, 30, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; height: 100%; display: flex; flex-direction: column;">
                <h4 style="color:var(--gold); margin:0 0 15px 0; font-size:15px; font-weight:800; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
                    [${conf.title}] ${d.name}
                </h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 20px; flex-grow: 1;">
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="color:#c8d6e5; font-size:12px; margin-bottom:6px; font-weight:bold; opacity:0.8;">✨ 現有詞條</div>
                        ${sbHtml}
                    </div>
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="color:#c8d6e5; font-size:12px; margin-bottom:6px; font-weight:bold; opacity:0.8;">💎 現有${msLabel}</div>
                        ${msHtml}
                    </div>
                </div>
                
                <div style="font-size:12px; color:#94a3b8; line-height:1.5; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px; border-left:3px solid var(--gold); margin-top: auto;">
                    *統計全職業最熱門的「各部位洗練」與「魔石鑲嵌」配置。<BR>手機板尚在調整中請用WEB瀏覽<br>
                    將抓取您身上裝備，吻合詞條榜顯示為 <b style="color:#2ecc71;">亮綠色</b>，吻合魔石榜顯示為 <b>品階對應色</b>，數值超越TOP者標記 <b style="color:#f1c40f;">UP!</b>。
                </div>
            </div>
        `;
    };

    window.currentStatPlaystyle = window.currentStatPlaystyle || 'PVE';

    // Precise keyword-based part detection

    const validSlots = [];
    let itemsPool = [...items];

    // Priority 1: Exact mapping by PartKey
    // Priority 1: Exact mapping by Match Function or PartKey
    slotConfig.forEach(conf => {
        let bestIdx = itemsPool.findIndex(i => {
            if (conf.match) return conf.match(i);
            const pk = window.getPartKey(i);
            return pk === conf.key || (conf.key.includes('Bracelet') && pk?.includes('Bracelet'));
        });
        if (bestIdx !== -1) {
            validSlots.push({ conf, userItem: itemsPool[bestIdx] });
            itemsPool.splice(bestIdx, 1);
        }
    });

    if (validSlots.length === 0) {
        container.innerHTML = `<div style="padding:40px; text-align:center; color:#ff6b6b; font-size:14px;">找不到可比對的穿戴裝備。</div>`;
        return;
    }

    // Determine target active key: use provided key, then global state, then first available slot
    if (!activeKey || !validSlots.some(s => s.conf.key === activeKey)) {
        activeKey = validSlots.length > 0 ? validSlots[0].conf.key : null;
    }

    // Persistent tracking
    window.__CURRENT_STATS_TAB__ = activeKey;

    let subNavHtml = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">`;
    subNavHtml += `<div style="display:flex; flex-wrap:wrap; gap:8px;" id="stats-sub-nav">`;
    validSlots.forEach((slot) => {
        const isActive = slot.conf.key === window.__CURRENT_STATS_TAB__;
        const activeClass = isActive ? "active" : "";

        subNavHtml += `
            <div 
                onclick="window.switchStatSubTab('${slot.conf.key}')"
                 class="stat-sub-tab-btn ${activeClass}" 
                 data-target="stat-tab-${slot.conf.key}">
                 ${slot.conf.title}
             </div>
        `;
    });

    subNavHtml += `</div></div>`;

    let playstyleSwitchHtml = `
        <div style="display:flex; background:rgba(0,0,0,0.3); border-radius:4px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); margin:-6px -4px; transform: scale(0.9); transform-origin: right;">
            <div onclick="window.switchStatPlaystyle('PVE')" 
                 style="cursor:pointer; padding:4px 12px; font-size:12px; font-weight:bold; background:${window.currentStatPlaystyle === 'PVE' ? 'var(--gold)' : 'transparent'}; color:${window.currentStatPlaystyle === 'PVE' ? '#000' : '#888'}; transition:all 0.2s;">
                 PVE
            </div>
            <div onclick="window.switchStatPlaystyle('PVP')" 
                 style="cursor:pointer; padding:4px 12px; font-size:12px; font-weight:bold; background:${window.currentStatPlaystyle === 'PVP' ? 'var(--gold)' : 'transparent'}; color:${window.currentStatPlaystyle === 'PVP' ? '#000' : '#888'}; transition:all 0.2s;">
                 PVP
            </div>
        </div>
    `;

    // Global script for toggling tabs
    window.switchStatSubTab = function (key) {
        window.__CURRENT_STATS_TAB__ = key;
        const btns = document.querySelectorAll('#stats-sub-nav .stat-sub-tab-btn');
        const contents = document.querySelectorAll('.stat-sub-tab-content');

        btns.forEach(b => {
            if (b.dataset.target === `stat-tab-${key}`) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });

        contents.forEach(c => {
            c.style.display = (c.id === `stat-tab-${key}`) ? 'block' : 'none';
        });
    };

    window.switchStatPlaystyle = function (mode) {
        if (window.currentStatPlaystyle === mode) return;
        window.currentStatPlaystyle = mode;
        if (window.__LAST_DATA_JSON__) {
            window.renderStatsTab(window.__LAST_DATA_JSON__, window.__CURRENT_STATS_TAB__);
        }
    };

    // Build Content Areas
    let blocksHtml = '';

    validSlots.forEach((slot, idx) => {
        let { conf, userItem } = slot;

        // Data Mapping Normalization: Normalize keys for dual slots like Earrings and Rings
        let dataKey = conf.key;
        if (dataKey.startsWith('Earring')) dataKey = 'Earring';
        if (dataKey.startsWith('Ring')) dataKey = 'Ring';
        if (dataKey.startsWith('Bracelet')) dataKey = 'Bracelet';

        let sbDist = STATIC_STATS_DATA[dataKey + '_' + window.currentStatPlaystyle] || [];

        const isAccessory = ['Cape', 'Necklace', 'Earring1', 'Earring2', 'Ring1', 'Ring2', 'Bracelet', 'Bracelet2'].includes(conf.key);
        const groupKey = isAccessory ? 'accessory' : 'gear';
        const msLabel = isAccessory ? '靈石' : '魔石';

        const msDistName = `MagicStone_${window.currentStatPlaystyle}_${groupKey}`;
        let msDist = STATIC_STATS_DATA[msDistName] || [];

        const isDisplay = (slot.conf.key === window.__CURRENT_STATS_TAB__) ? 'block' : 'none';

        blocksHtml += `
                <div id="stat-tab-${slot.conf.key}" class="stat-sub-tab-content" style="display:${isDisplay};">
                    <div class="stats-inner-card" style="background: rgba(26, 35, 50, 0.4); border-radius: 12px; padding: 15px;">
                        <div class="stat-comparison-grid">

                            <!-- 左半邊：排行榜 -->
                            <div class="stat-ranking-grid">
                                <div>
                                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(100, 100, 255, 0.15); padding:8px 10px; font-weight:bold; font-size:13px; color:#c8d6e5; border-radius:4px 4px 0 0; border-bottom:1px solid rgba(100,100,255,0.2);">
                                        <div>✨ 詞條榜 (Top 10)</div>
                                        ${playstyleSwitchHtml}
                                    </div>
                                    <div style="padding:0;">
                                        ${renderTop10List(sbDist, soulbindNameMap, false, userItem)}
                                    </div>
                                </div>
                                <div>
                                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255, 100, 100, 0.15); padding:8px 10px; font-weight:bold; font-size:13px; color:#c8d6e5; border-radius:4px 4px 0 0; border-bottom:1px solid rgba(255,100,100,0.2);">
                                        <div>💎 ${msLabel}榜 (Top 10)</div>
                                        ${playstyleSwitchHtml}
                                    </div>
                                    <div style="padding:0;">
                                        ${renderTop10List(msDist, magicStoneMap, true, userItem)}
                                    </div>
                                </div>
                            </div>

                            <!-- 右半邊：裝備明細 -->
                            <div>
                                ${renderUserItem(userItem, sbDist, msDist, conf)}
                            </div>

                        </div>
                    </div>
                </div>
                `;
    });

    let html = `
                <div class="stats-outer-wrapper" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                    ${subNavHtml}
                    ${blocksHtml}
                </div>
            `;

    container.innerHTML = html;

    // Immediately sync the UI to the correct active tab
    if (activeKey) {
        window.switchStatSubTab(activeKey);
    }
};

window.switchEquipTab = function (tab) {
    const layoutTab = document.getElementById('equip-tab-layout');
    const detailTab = document.getElementById('equip-tab-detail');
    const simpleTab = document.getElementById('equip-tab-simple');
    const statsTab = document.getElementById('equip-tab-stats');

    const btnLayout = document.getElementById('tab-btn-equip-layout');
    const btnDetail = document.getElementById('tab-btn-equip-detail');
    const btnSimple = document.getElementById('tab-btn-equip-simple');
    const btnStats = document.getElementById('tab-btn-equip-stats');

    if (!layoutTab || !detailTab || !simpleTab || !statsTab) return;

    // Hide all tab contents
    layoutTab.style.display = 'none';
    detailTab.style.display = 'none';
    simpleTab.style.display = 'none';
    statsTab.style.display = 'none';

    if (btnLayout) btnLayout.classList.remove('active');
    if (btnDetail) btnDetail.classList.remove('active');
    if (btnSimple) btnSimple.classList.remove('active');
    if (btnStats) btnStats.classList.remove('active');

    if (tab === 'detail') {
        detailTab.style.display = 'block';
        if (btnDetail) btnDetail.classList.add('active');
    } else if (tab === 'layout') {
        layoutTab.style.display = 'block';
        if (btnLayout) btnLayout.classList.add('active');
        if (window.__LAST_DATA_JSON__ && typeof window.renderLayoutTab === 'function') {
            window.renderLayoutTab(window.__LAST_DATA_JSON__);
        }
    } else if (tab === 'stats') {
        statsTab.style.display = 'block';
        if (btnStats) btnStats.classList.add('active');
        if (window.__LAST_DATA_JSON__ && typeof window.renderStatsTab === 'function') {
            window.renderStatsTab(window.__LAST_DATA_JSON__);
        }
    } else {
        simpleTab.style.display = 'block';
        if (btnSimple) btnSimple.classList.add('active');
    }
};

// --- 📓 作者日記功能 ---
window.openCalculationGuide = function () {
    const el = document.getElementById('guide-overlay');
    if (el) {
        el.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};
window.closeCalculationGuide = function () {
    const el = document.getElementById('guide-overlay');
    if (el) {
        el.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.openAuthorDiary = function () {
    const overlay = document.getElementById('diary-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeAuthorDiary = function () {
    const overlay = document.getElementById('diary-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.switchCollectionTab = function (tab) {
    const container = document.getElementById('nav-target-collection');
    if (!container) return;

    // 1. 先紀錄目前容器相對於視窗的位置，防範高度塌陷導致的跳動
    const rect = container.getBoundingClientRect();
    const isMobile = window.innerWidth <= 1024;
    const currentTop = window.scrollY + rect.top;

    // 2. 執行分頁切換
    const tabs = ['skill', 'title', 'pet', 'arcana', 'set'];
    tabs.forEach(t => {
        const pane = document.getElementById('col-tab-' + t);
        const btn = document.getElementById('tab-btn-col-' + t);
        if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
        if (btn) {
            if (t === tab) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });

    // 3. 🛡️ 精準定位校準 (靠上對齊)
    if (isMobile) {
        // 完全靠上對齊
        const offset = 0;

        // 延遲執行捲動，確保內容切換後的 DOM 高度與佈局已經穩定
        requestAnimationFrame(() => {
            const containerAfter = document.getElementById('nav-target-collection');
            if (containerAfter) {
                const newRect = containerAfter.getBoundingClientRect();
                const targetY = window.scrollY + newRect.top - offset;

                // 只有當容器頂部偏離視窗頂端時才發動捲動
                if (Math.abs(newRect.top - offset) > 5) {
                    window.scrollTo({
                        top: targetY,
                        behavior: 'smooth'
                    });
                }
            }
        });
    }
};

window.scrollToCollection = function (tab) {
    if (typeof window.switchCollectionTab === 'function') {
        window.switchCollectionTab(tab);
    }
    const container = document.getElementById('nav-target-collection');
    if (container) {
        const rect = container.getBoundingClientRect();
        // 靠上對齊
        const offset = 0;
        window.scrollTo({
            top: window.scrollY + rect.top - offset,
            behavior: 'smooth'
        });
    }
};

window.showSkillHoverTooltip = function (el, event, mode = 'hover') {
    if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    if (window.tooltipHideTimer) {
        clearTimeout(window.tooltipHideTimer);
        window.tooltipHideTimer = null;
    }
    const tipData = el.querySelector('.skill-tip-data');
    if (!tipData) return;

    const overlay = document.getElementById('equip-tooltip-overlay');
    const content = document.getElementById('equip-tooltip-content');
    if (!overlay || !content) return;

    const isMobile = getIsMobile();
    const finalMode = isMobile ? 'modal' : mode;

    const name = tipData.getAttribute('data-name');
    const iconUrl = tipData.getAttribute('data-icon');
    const categoryName = tipData.getAttribute('data-category') === 'Passive' ? '被動技能' : (tipData.getAttribute('data-category') === 'Active' ? '主動技能' : '技能');
    const level = parseInt(tipData.getAttribute('data-level')) || 0;
    const baseLv = parseInt(tipData.getAttribute('data-base')) || 0;
    const plateLv = parseInt(tipData.getAttribute('data-plate')) || 0;
    const cardLv = parseInt(tipData.getAttribute('data-card')) || 0;
    const effHtml = tipData.innerHTML;

    let subHtml = ``;
    if (plateLv > 0 || cardLv > 0) {
        subHtml += `<div class="stat-row"><span class="stat-label">基礎等級</span><div class="stat-leader"></div><span class="stat-value">Lv.${baseLv}</span></div>`;
        if (plateLv > 0) subHtml += `<div class="stat-row"><span class="stat-label val-bonus">板塊加成</span><div class="stat-leader"></div><span class="stat-value val-bonus">+${plateLv}</span></div>`;
        if (cardLv > 0) subHtml += `<div class="stat-row"><span class="stat-label" style="color:#f1c40f;">卡片加成</span><div class="stat-leader"></div><span class="stat-value" style="color:#f1c40f;">+${cardLv}</span></div>`;
        subHtml += `<div class="stat-row" style="margin-top:5px; border-top:1px solid rgba(255,255,255,0.05); padding-top:5px;"><span class="stat-label val-orange">總等級</span><div class="stat-leader"></div><span class="stat-value val-orange">Lv.${level}</span></div>`;
    } else {
        subHtml += `<div class="stat-row"><span class="stat-label">技能等級</span><div class="stat-leader"></div><span class="stat-value val-orange">Lv.${level}</span></div>`;
    }

    content.className = `equip-tooltip tooltip-rarity-normal`;
    if (isMobile || finalMode === 'modal') {
        overlay.style.background = 'rgba(0, 0, 0, 0.75)'; overlay.style.backdropFilter = 'blur(8px)';
        overlay.style.pointerEvents = 'auto'; overlay.style.display = 'flex';
        overlay.style.alignItems = 'flex-start';
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '60px 20px 20px 20px';
        overlay.onclick = function (e) { if (e.target === overlay) window.closeEquipTooltip(); };
    } else {
        content.classList.add('is-hover');
        overlay.style.background = 'transparent'; overlay.style.backdropFilter = 'none';
        overlay.style.pointerEvents = 'none'; overlay.style.display = 'block';
        overlay.onclick = null;
    }

    content.innerHTML = `
        <div class="close-tooltip-circle" onclick="window.closeEquipTooltip(event)">×</div>
        <div class="tooltip-header">
            <div class="tooltip-icon-frame"><img src="${iconUrl}"></div>
            <div class="tooltip-title-area">
                <div class="tooltip-name">${name}</div>
                <div class="tooltip-sub-info">
                    <span class="tooltip-grade-label val-bonus">${categoryName}</span>
                </div>
            </div>
        </div>
        <div class="tooltip-body">
            <div class="tooltip-section">
                ${subHtml}
            </div>
            ${(() => {
            const cleaned = effHtml.replace(/^(?:\s|<br\s*\/?>|&nbsp;)+/gi, '').replace(/(?:\s|<br\s*\/?>|&nbsp;)+$/gi, '');
            if (cleaned.indexOf('⏳ 載入中...') === -1 && cleaned.indexOf('💡 數據未收錄') === -1) {
                return `
                    <div class="tooltip-section" style="margin-top:2px; border-top:none; padding-top:0;">
                        <div style="background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); font-size:13px; line-height:1.6;">
                            ${cleaned}
                        </div>
                    </div>`;
            }
            return `<div style="margin-top:5px; padding:0 5px; font-size:12px; color:#636e72;">${cleaned}</div>`;
        })()}
        </div>
    `;

    if (finalMode === 'hover' && event && !isMobile) {
        let x = event.clientX + 30, y = event.clientY - 50;
        if (x + 350 > window.innerWidth) x = event.clientX - 360;
        content.style.position = 'fixed'; content.style.left = x + 'px'; content.style.top = y + 'px';
        content.style.transform = '';
        setTimeout(() => {
            const rect = content.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) content.style.top = (window.innerHeight - rect.height - 20) + 'px';
            if (rect.top < 0) content.style.top = '10px';
        }, 0);
    } else {
        // Modal 模式：重置所有定位樣式
        content.style.position = '';
        content.style.left = '';
        content.style.top = '';
        content.style.transform = '';
    }
};
