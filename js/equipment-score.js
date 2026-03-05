/**
 * Aion2 角色實力綜合評分系統 (equipment-score.js)
 * 
 * 此檔案負責計算角色整體的「成型度」分數，包含：
 * 1. 裝備品階評分：對武防飾品進行品階、強化與突破等級的權重計算。
 * 2. 多維度實力分析：整合板塊解鎖進度、寵物洞察力、技能烙印強度與稱號蒐集。
 * 3. 健檢建議生成：根據各項得分比例，自動生成具體的機體優化建議項目。
 * 4. 數據庫同步：從外部來源同步裝備品階庫以確保評分基準準確。
 */

// 裝備品階設定 (分數、名稱、顏色)
// 裝備品階設定 (分數、名稱、顏色)
// 裝備品階設定 (分數、名稱、顏色)
const RARITY_CONFIG = {
    'mythic': { score: 10, name: '神話', color: '#e67e22' }, // 神話/古代 (橙)
    'legendary': { score: 7, name: '傳說', color: '#f1c40f' }, // 傳說/唯一/獨特 (金)
    'epic': { score: 4.5, name: '史詩', color: '#3498db' }, // 史詩/傳承 (藍)
    'special': { score: 2.5, name: '特殊', color: '#00ffcc' }, // 特殊 (青)
    'rare': { score: 1.5, name: '稀有', color: '#2ecc71' }, // 稀有 (綠)
    'common': { score: 0.5, name: '普通', color: '#ffffff' } // 普通 (白)
};

// 全域變數：儲存外部 API 取得的物品資料庫
let EXTERNAL_ITEM_DB = {};
let hasFetchedExternalDB = false;

// 透過 Proxy 取得 QuestLog 資料庫 (針對防具與飾品)
async function fetchItemDetailsFromQuestLog() {
    if (hasFetchedExternalDB) return;

    // --- 🚀 快取機制優化 ---
    const CACHE_KEY = 'aion_item_db_v1';
    const CACHE_TIME_KEY = 'aion_item_db_time';
    const EXPIRE_TIME = 24 * 60 * 60 * 1000; // 24小時

    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
        if (cachedData && cachedTime && (Date.now() - parseInt(cachedTime) < EXPIRE_TIME)) {
            EXTERNAL_ITEM_DB = JSON.parse(cachedData);
            hasFetchedExternalDB = true;
            // [Cache] log 已移除
            return;
        }
    } catch (e) { console.warn("Cache load failed", e); }


    // 正在從 QuestLog 同步物品資料庫 log 已移除
    // --- End 快取機制 ---

    // 定義要抓取的類別 (只抓前 2 頁的高級裝備應該就夠了)
    const categories = ['armor', 'accessory'];
    const pages = [1, 2];

    // 建立請求清單
    const requests = [];

    categories.forEach(cat => {
        pages.forEach(page => {
            const input = {
                language: "zh",
                page: page,
                mainCategory: cat,
                subCategory: "",
                facets: {}
            };
            const inputStr = encodeURIComponent(JSON.stringify(input));
            const targetUrl = `https://questlog.gg/aion-2/api/trpc/database.getItems?input=${inputStr}`;
            const proxyUrl = `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(targetUrl)}`;

            requests.push(
                fetch(proxyUrl)
                    .then(res => res.json())
                    .then(data => {
                        if (data && data.result && data.result.data && data.result.data.json && data.result.data.json.items) {
                            return data.result.data.json.items;
                        }
                        return [];
                    })
                    .catch(err => {
                        console.warn(`Fetch error for ${cat} page ${page}:`, err);
                        return [];
                    })
            );
        });
    });

    try {
        const results = await Promise.all(requests);
        results.flat().forEach(item => {
            if (item && item.name) {
                EXTERNAL_ITEM_DB[item.name] = {
                    quality: item.quality,
                    grade: item.grade,
                    level: item.level
                };
            }
        });

        hasFetchedExternalDB = true;
        // QuestLog 資料庫同步完成 log 已移除

        // 💾 儲存到快取
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(EXTERNAL_ITEM_DB));
            localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        } catch (e) {
            // 如果超出 localStorage 額度，清空這類快取
            if (e.name === 'QuotaExceededError') {
                localStorage.removeItem(CACHE_KEY);
                localStorage.removeItem(CACHE_TIME_KEY);
            }
        }

        if (typeof window.renderEquipment === 'function') {
            // 重新計算並渲染裝備 log 已移除
            window.renderEquipment();
        }

    } catch (e) {
        console.error("QuestLog Sync Failed:", e);
    }
}

// 取得單件裝備的品階資訊 (供外部調用)
function getEquipmentRarityInfo(item) {
    if (!item) return null;

    // 支援傳入包裝物件 {detail: ...} 或直接傳入 detail 資料本身
    const d = item.detail || item;
    const name = d.name || '';
    const lowerName = name.toLowerCase();

    // 0. 強制關鍵字判定 (古代/神話優先權最高，確保古代系列顯示為橙色)
    if (lowerName.includes('神話') || lowerName.includes('古代') || lowerName.includes('ancient') || lowerName.includes('mythic')) {
        const config = RARITY_CONFIG['mythic'];
        const isShining = name.includes('閃耀');
        return {
            rarityKey: 'mythic',
            name: config.name,
            baseScore: config.score,
            color: config.color,
            isShining: isShining,
            source: 'keyword'
        };
    }

    const rawGrade = (d.quality || d.grade || '').toLowerCase();

    // 決定正規化品階 Key
    let rarityKey = 'common';
    let source = 'keyword'; // 來源標記: keyword 或 db

    // 0. 優先檢查外部資料庫 (QuestLog)
    if (EXTERNAL_ITEM_DB[name]) {
        const dbItem = EXTERNAL_ITEM_DB[name];
        const dbGradeNum = parseInt(dbItem.grade || dbItem.quality || 0);
        const dbQuality = String(dbItem.quality || dbItem.grade || '').toLowerCase();

        // 優先使用數字 grade 判斷 (QuestLog API: 51/41/31/21/11)
        if (dbGradeNum >= 51) {
            rarityKey = 'mythic';
        } else if (dbGradeNum >= 41) {
            rarityKey = 'legendary';
        } else if (dbGradeNum >= 31) {
            rarityKey = 'epic';
        } else if (dbGradeNum >= 21) {
            rarityKey = 'rare';
        } else if (dbGradeNum >= 11) {
            rarityKey = 'common';
        }

        // 備用：字串判斷 (若數字判斷無法判定)
        if (rarityKey === 'common' && dbGradeNum === 0) {
            if (dbQuality.includes('mythic') || dbQuality.includes('ancient') || dbQuality === '神話' || dbQuality === '古代') {
                rarityKey = 'mythic';
            } else if (dbQuality.includes('unique') || dbQuality === '唯一' || dbQuality === '獨特') {
                rarityKey = 'legendary';
            } else if (dbQuality.includes('legend') || dbQuality.includes('eternal') || dbQuality === '傳說' || dbQuality === '傳承' || dbQuality === '史詩' || dbQuality.includes('epic')) {
                rarityKey = 'epic';
            } else if (dbQuality.includes('rare') || dbQuality === '稀有') {
                rarityKey = 'rare';
            } else if (dbQuality.includes('special') || dbQuality === '特殊') {
                rarityKey = 'special';
            }
        }

        if (rarityKey !== 'common') source = 'db';
    }

    // 如果外部資料庫沒找到，或只找到普通，則使用關鍵字判斷 (Fallback)
    if (rarityKey === 'common') {
        const lowerName = name.toLowerCase();

        // 數值 Grade 判斷 (QuestLog API 數值系統)
        // API 實際回傳: 51=神話/古代, 41=唯一/獨特, 31=傳說, 21=稀有, 11=普通
        const gradeNum = parseInt(d.grade || d.quality || 0);
        if (gradeNum >= 51) {
            rarityKey = 'mythic';     // grade 51 = 神話/古代 (橙)
        } else if (gradeNum >= 41) {
            rarityKey = 'legendary';  // grade 41 = 唯一/獨特 (金)
        } else if (gradeNum >= 31) {
            rarityKey = 'epic';       // grade 31 = 傳說 (藍)
        } else if (gradeNum >= 21) {
            rarityKey = 'rare';       // grade 21 = 稀有 (綠)
        } else if (gradeNum >= 11) {
            rarityKey = 'common';     // grade 11 = 普通 (白)
        }

        // 1. 優先檢查 API grade (字串判斷)
        if (rarityKey === 'common') {
            if (rawGrade.includes('mythic') || rawGrade.includes('ancient') || rawGrade === '神話' || rawGrade === '古代') {
                rarityKey = 'mythic';
            } else if (rawGrade.includes('unique') || rawGrade === '唯一' || rawGrade === '獨特') {
                rarityKey = 'legendary'; // 使用者要求的 Unique -> 金色 (對應 config 中的 legendary)
            } else if (rawGrade.includes('legend') || rawGrade.includes('eternal') || rawGrade === '傳說' || rawGrade === '傳承') {
                rarityKey = 'epic'; // 使用者要求的 Legend -> 藍色 (對應 config 中的 epic)
            } else if (rawGrade.includes('special') || rawGrade === '特殊') {
                rarityKey = 'special';
            } else if (rawGrade.includes('rare') || rawGrade === '稀有') {
                rarityKey = 'rare';
            }
        }

        // 2. 名稱關鍵字判斷 (作為補充)
        if (rarityKey === 'common') {
            if (lowerName.includes('霸龍') || lowerName.includes('應龍') || lowerName.includes('雙龍王') || lowerName.includes('夔龍') || lowerName.includes('盧德萊') || lowerName.includes('神話') || lowerName.includes('古代') || lowerName.includes('被侵蝕') || lowerName.includes('殘影')) {
                rarityKey = 'mythic';
            } else if (lowerName.includes('天龍') || lowerName.includes('鳴龍') || lowerName.includes('白龍') || lowerName.includes('真龍') || lowerName.includes('唯一') || lowerName.includes('獨特') || lowerName.includes('軍團長')) {
                rarityKey = 'legendary';
            } else if (lowerName.includes('傳說') || lowerName.includes('英雄') || lowerName.includes('暴風') || lowerName.includes('傳承') || lowerName.includes('史詩') || lowerName.includes('試煉')) {
                rarityKey = 'epic';
            } else if (lowerName.includes('特殊')) {
                rarityKey = 'special';
            } else if (lowerName.includes('稀有') || lowerName.includes('藍')) {
                rarityKey = 'rare';
            }
        }
    }

    const config = RARITY_CONFIG[rarityKey];
    let baseScore = config.score;
    let rarityName = config.name;
    let color = config.color;

    // 閃耀加成
    const isShining = name.includes('閃耀');
    if (rarityKey === 'common' && isShining) {
        baseScore = 7; // 使用傳說分數
        rarityName = '閃耀(傳說)';
        color = RARITY_CONFIG['legendary'].color;
        rarityKey = 'legendary';
    }

    return {
        rarityKey: rarityKey,
        name: rarityName,
        baseScore: baseScore,
        color: color,
        isShining: isShining,
        source: source
    };
}

// 計算裝備品階分數 (含關鍵字判斷與顏色)
function calculateEquipmentRarityScore(itemDetails) {
    if (!itemDetails || !Array.isArray(itemDetails)) {
        return { score: 0, details: [] };
    }

    let totalRawScore = 0;  // 原始分數總和（用於顯示）
    let totalConvertedScore = 0;  // 轉換後分數總和（用於計算）
    let details = [];

    // 定義單件裝備的滿分參考值
    // 假設：神話(15) × 最高倍率(3.0) = 45分為單件滿分
    const SINGLE_ITEM_MAX = 45;

    // 🛡️ 去重複：同一 slotPos 只計算一次（不影響兩戒/兩耳等不同槽位）
    const seenSlots = new Set();
    const uniqueItems = itemDetails.filter(item => {
        const s = item.slotPos;
        if (seenSlots.has(s)) return false;
        seenSlots.add(s);
        return true;
    });

    uniqueItems.forEach(item => {
        const d = item.detail;
        if (!d || !d.name) return;

        const slot = Number(item.slotPos);
        // Aion slot 定義: 0(主手), 1(副手), 2(頭), 3(身), 4(手), 5(腳), 6(肩), 7(項鍊), 8(耳環1), 9(耳環2), 10(戒1), 11(戒2), 12(腰), 15(翅膀), etc.
        // 擴大允許範圍 0 ~ 40 以涵蓋所有裝備 (包含飾品與主手武器)
        if (isNaN(slot) || slot < 0 || slot > 40) return;

        // 使用共用邏輯取得品階資訊
        const info = getEquipmentRarityInfo(item);
        if (!info) return;

        if (info.baseScore > 0 || info.rarityKey !== 'common') {
            // === 方案一：指數加權系統 ===

            // 基礎分 = 品階分數
            const baseScore = info.baseScore;

            // 取得強化和突破等級
            const exceedLevel = item.exceedLevel || 0;
            // 如果 d.enchantLevel 包含突破等級，則扣除以獲得純強化等級 (上限通常為 20)
            const rawEnchantLevel = d.enchantLevel || 0;
            const pureEnchantLevel = Math.max(0, rawEnchantLevel - exceedLevel);
            const totalEnchant = rawEnchantLevel; // 總等級即為 API 的 enchantLevel

            // 強化加成 = 基礎分 × (純強化等級 / 20)^1.2
            const enchantRatio = pureEnchantLevel / 20;
            const enchantBonus = baseScore * Math.pow(enchantRatio, 1.2);

            // 突破加成 = 基礎分 × (突破等級 / 5)^1.5
            const exceedRatio = exceedLevel / 5;
            const exceedBonus = baseScore * Math.pow(exceedRatio, 1.5);

            // 閃耀加成 = 基礎分 × 0.2
            const shineBonus = info.isShining ? baseScore * 0.2 : 0;

            // 單件得分 = 基礎分 + 強化加成 + 突破加成 + 閃耀加成
            const itemScore = baseScore + enchantBonus + exceedBonus + shineBonus;

            // 四捨五入到小數點後1位
            const itemRawScore = Math.round(itemScore * 10) / 10;

            totalRawScore += itemRawScore;
            totalConvertedScore += itemRawScore;  // 方案一不需要二次轉換

            details.push({
                name: d.name,
                dragonType: info.name,
                baseScore: baseScore,
                enchantLevel: totalEnchant,  // 顯示用：顯示總合等級
                pureEnchantLevel: pureEnchantLevel,  // 分析用：純強化等級
                exceedLevel: exceedLevel,
                isShining: info.isShining,
                enchantBonus: Math.round(enchantBonus * 10) / 10,
                exceedBonus: Math.round(exceedBonus * 10) / 10,
                shineBonus: Math.round(shineBonus * 10) / 10,
                score: itemRawScore,  // 單件得分
                color: info.color,
                id: d.id || item.itemId // Added ID for reference
            });
        }
    });

    // 排序: 分數高到低
    details.sort((a, b) => b.score - a.score);

    // 返回總分（用於最終評分計算）
    // 滿分修正：540分 (武防8 + 可突破飾品8 + 不可突破飾品4 = 20件)
    // 依據 calculateEquipmentScore 的基準
    return {
        score: totalConvertedScore,  // 總分
        maxScore: 540,  // 滿分
        rawScore: totalRawScore,  // 原始總分（同總分）
        details: details
    };
}


// 計算古文石分數（區分古文石與護身符）
function calculateMagicStoneScore(itemDetails) {
    if (!itemDetails || !Array.isArray(itemDetails)) {
        return { score: 0, maxScore: 60, rawScore: 0, count: 0 };
    }

    // 定義品階基礎分（僅用於護身符）
    const rarityScores = {
        '傳說': 10,
        '史詩': 6,
        '稀有': 3
    };

    // 古文石（無品階，直接用強化等級）
    const magicStones = ['激戰古文石', '專心古文石'];

    // 護身符（有品階，用比例計算）
    const amulets = ['啟示護身符', '激戰護身符'];

    let totalRawScore = 0;
    let count = 0;
    let details = [];

    // 🛡️ 去重複：同一 slotPos 只計算一次
    const seenSlots2 = new Set();
    const uniqueItems2 = itemDetails.filter(item => {
        const s = item.slotPos;
        if (seenSlots2.has(s)) return false;
        seenSlots2.add(s);
        return true;
    });

    uniqueItems2.forEach(item => {
        const d = item.detail;
        if (!d || !d.name) return;

        const enchantLevel = d.enchantLevel || 0;
        let itemScore = 0;

        // 判斷是古文石還是護身符
        const isMagicStone = magicStones.some(slot => d.name.includes(slot));
        const isAmulet = amulets.some(slot => d.name.includes(slot));

        if (isMagicStone) {
            // 古文石：直接用強化等級 (Max 10)
            itemScore = enchantLevel;

            details.push({
                name: d.name,
                type: '古文石',
                enchantLevel: enchantLevel,
                score: itemScore
            });

            totalRawScore += itemScore;
            count++;

        } else if (isAmulet) {
            // 護身符：品階係數 * 強化等級加成 (Max Lv10) -> 滿分20分
            // 傳說係數: 10, 史詩: 6, 稀有: 3
            // 強化加成: 1 + (enchantLevel / 10)

            const quality = d.quality || d.grade || '';
            let baseParams = 0;

            // 判斷品階係數 (權重)
            if (quality.includes('傳說') || quality.includes('Legendary')) {
                baseParams = 10; // 基礎分
            } else if (quality.includes('史詩') || quality.includes('Epic') || quality.includes('唯一')) {
                baseParams = 6;
            } else if (quality.includes('稀有') || quality.includes('Rare')) {
                baseParams = 3;
            }

            if (baseParams === 0) return; // 品階不符，跳過

            // 計算分數：基礎分 * (1 + 強化等級/10)
            const enchantRatio = 1 + (enchantLevel / 10);
            const rawScore = baseParams * enchantRatio;

            // 4捨2入
            const decimal = rawScore - Math.floor(rawScore);
            itemScore = decimal <= 0.2 ? Math.floor(rawScore) : Math.ceil(rawScore);

            details.push({
                name: d.name,
                type: '護身符',
                quality: quality,
                baseScore: baseParams,
                enchantLevel: enchantLevel,
                score: itemScore
            });

            totalRawScore += itemScore;
            count++;
        }
    });

    // 排序: 分數高到低
    details.sort((a, b) => b.score - a.score);

    // 滿分：2個古文石×10 + 2個護身符×20 = 20 + 40 = 60分
    const maxScore = 60;

    return {
        score: totalRawScore,
        maxScore: maxScore,
        rawScore: totalRawScore,
        count: count,
        details: details
    };
}


// 計算板塊數量分數
function calculateBoardScore(boardData) {
    // boardData 預期為 Array: daevanionBoardList
    if (!boardData || !Array.isArray(boardData)) {
        return { score: 0, totalBoards: 0, maxScore: 0, rawScore: 0, details: [] };
    }

    let totalWeightScore = 0; // 加權後的總分 (滿分15)
    let totalNodes = 0;
    let maxNodes = 0;
    let details = [];

    // 定義權重 
    const weightMap = {
        '奈薩肯': 1.5,
        '吉凱爾': 1.5,
        '白傑爾': 1.5,
        '崔妮爾': 1.5,
        '瑪爾庫坦': 3.0, // 中高難度
        '艾瑞爾': 2.0,  // 困難 (PVE/PVP)
        '阿斯佩爾': 4.0  // 極難
    };

    // 計算所有板塊分數
    boardData.forEach(board => {
        if (board && typeof board.openNodeCount === 'number') {
            const count = board.openNodeCount;
            const total = board.totalNodeCount || 0;
            const name = board.name || '未知板塊';

            totalNodes += count;
            maxNodes += total;

            // 查找對應權重
            let weight = 1.5; // 預設權重
            for (const key in weightMap) {
                if (name.includes(key)) {
                    weight = weightMap[key];
                    break;
                }
            }

            // 動態調整滿分：原本滿分為 15，加上新版塊會變化。為了保證總分為 15 不變更總評分 100 分體系，我們計算佔總權重的比例
            // 但如果採用絕對權重計分，會超過 15 分，這裡改為根據實際開放板塊的總權重來做 normalize
            // 目前先採用原有邏輯，如果是新增板塊，這裡會單純把它的分數加進去，後續在最後用縮放處理

            const boardScore = total > 0 ? (count / total) * weight : 0;
            totalWeightScore += boardScore;

            details.push({
                name: name,
                count: count,
                max: total,
                weight: weight,
                score: Math.round(boardScore * 10) / 10
            });
        }
    });

    // 總分四捨五入到小數點第一位
    const finalScore = Math.round(totalWeightScore * 10) / 10;

    // 返回結構包含加權後的總分，上限強制鎖定在 15 避免破壞 100 分計算
    return {
        score: Math.min(finalScore, 15),        // 加權後的總分 (Max 15)
        rawScore: totalNodes,     // 原始總板塊數
        maxRawScore: maxNodes,    // 總節點上限
        maxScore: 15,             // 滿分
        totalBoards: totalNodes,  // 總板塊數 (相容性)
        details: details
    };
}

// 計算寵物理解度分數
// 計算寵物理解度分數
// 新規則：8種理解度 (4大類 x 2階段)，滿分 20 分
// 公式: (達成數 / 8) * 20
function calculatePetInsightScore(petInsight) {
    if (!petInsight || typeof petInsight !== 'object') {
        return { score: 0, maxScore: 20, totalClean: 0, level3Count: 0, level4Count: 0 };
    }

    let rawScore = 0; // 原始達成數 (0-8)
    let totalLevel3 = 0;
    let totalLevel4 = 0;
    let details = [];

    // petInsight 結構: { intellect: {...}, feral: {...}, nature: {...}, trans: {...} }
    const insightTypes = ['intellect', 'feral', 'nature', 'trans'];

    insightTypes.forEach(type => {
        const data = petInsight[type];
        if (!data) return;

        const total = data.totalInGame || 0;
        const lv3 = data.atLeastLv3Count || 0;
        const lv4 = data.atLeastLv4MaxCount || 0;

        totalLevel3 += lv3;
        totalLevel4 += lv4;

        let typeRawScore = 0;
        if (total > 0) {
            // 達成 Lv3 (按比例算，最大 1 點)
            const lv3Share = Math.min(1, lv3 / total);
            // 達成 Lv4 (按比例算，最大 1 點)
            const lv4Share = Math.min(1, lv4 / total);

            typeRawScore = lv3Share + lv4Share;
            rawScore += typeRawScore;
        }

        details.push({
            type: type,
            total: total,
            lv3: lv3,
            lv4: lv4,
            rawScore: Math.round(typeRawScore * 10) / 10
        });
    });

    // 換算為 20 分制
    const finalScore = Math.round((rawScore / 8) * 20 * 10) / 10;

    return {
        score: finalScore,      // 最終分數 (0-20)
        maxScore: 20,           // 滿分
        totalClean: rawScore,   // 達成種類數 (0-8)
        maxRawScore: 8,         // 達成種類上限
        level3Count: totalLevel3,
        level4Count: totalLevel4,
        details: details
    };
}

// 計算技能烙印分數（新版：階梯式積分）
// Lv 1-4: 5分
// Lv 5-9: 20分 (特化I)
// Lv 10-14: 45分 (特化II)
// Lv 15-19: 75分 (特化III)
// Lv 20: 100分 (特化IV)
function calculateStigmaScore(skillData) {
    if (!skillData || typeof skillData !== 'object') {
        return { score: 0, maxScore: 30, rawScore: 0, maxRawScore: 1200, count: 0, details: [] };
    }

    let allSkills = [];
    if (skillData.stigma && Array.isArray(skillData.stigma)) {
        skillData.stigma.forEach(skill => {
            // 寬鬆過濾：排除明確指定為何非烙印的 Active 與 Passive 技能
            if (skill.category === 'Active' || skill.category === 'Passive') return;

            let level = 0;
            // 優先級偵測：level > skillLevel > enchantLevel
            if (skill.level) level = skill.level;
            else if (skill.skillLevel) level = skill.skillLevel;
            else if (skill.enchantLevel) level = skill.enchantLevel;

            // 移除模糊搜尋，因為可能抓到 learnLevel 或 maxLevel (導致沒學的技能顯示 Lv22)

            // 排除等級為 0 的技能
            if (!level || level <= 0) {
                console.log(`DEBUG: Skill ${skill.name} skipped (level 0)`);
                return;
            }

            console.log(`DEBUG: Processing stigma ${skill.name} with level ${level}`);

            allSkills.push({
                name: skill.name,
                level: level,
                category: skill.category,
                points: 0 // 預設值
            });
        });
    }

    // 依等級排序 (由高到低)
    allSkills.sort((a, b) => b.level - a.level);

    // 取前 12 強
    const topSkills = allSkills.slice(0, 12);

    let totalIntensity = 0; // 總強度
    let details = [];

    topSkills.forEach(skill => {
        let intensity = 5; // 基礎分 (Lv1-4)
        if (skill.level >= 20) intensity = 100;
        else if (skill.level >= 15) intensity = 75;
        else if (skill.level >= 10) intensity = 45;
        else if (skill.level >= 5) intensity = 20;

        totalIntensity += intensity;

        details.push({
            name: skill.name,
            level: skill.level,
            points: intensity // 單技強度 (用於顯示權重)
        });
    });

    // 換算總分 (分段式函數)
    // 階段一: 0~400強度 (4個Lv20) -> 拿滿前 80% 分數 (24分) - 鼓勵達成核心目標
    // 階段二: 400~1200強度 -> 爭取剩下 20% 分數 (6分) - 極限追求
    let finalScore = 0;
    if (totalIntensity <= 400) {
        // 核心階段: 線性成長，400強度即得24分
        finalScore = (totalIntensity / 400) * 24;
    } else {
        // 極限階段: 基礎24分 + 超出部分的比例
        // 剩下 800 強度分配 6 分
        finalScore = 24 + ((totalIntensity - 400) / 800) * 6;
    }

    finalScore = Math.min(Math.round(finalScore * 10) / 10, 30);

    return {
        score: finalScore,
        maxScore: 30,
        rawScore: totalIntensity, // 顯示總強度
        maxRawScore: 1200,        // 滿分強度
        totalPoints: totalIntensity,
        count: topSkills.length,
        details: details
    };
}

// 計算稱號數量分數
function calculateTitleScore(titleData) {
    if (!titleData || typeof titleData !== 'object') {
        return { score: 0, maxScore: 5, ownedCount: 0, totalCount: 400 };
    }

    const ownedCount = titleData.ownedCount || 0;
    const totalCount = titleData.totalCount || 400; // 使用 API 提供的總數

    // 稱號評分：採用動態分段權重 (總分 5 分)
    // 核心階段 (0 ~ 50% 總數) -> 佔 80% 分數 (4分)
    // 極限階段 (50% ~ 100% 總數) -> 佔 20% 分數 (1分)
    const milestone = Math.floor(totalCount * 0.5);

    let score = 0;
    if (ownedCount <= milestone) {
        // 核心階段
        score = milestone > 0 ? (ownedCount / milestone) * 4 : 0;
    } else {
        // 極限階段
        const remainingTitles = totalCount - milestone;
        score = 4 + (remainingTitles > 0 ? ((ownedCount - milestone) / remainingTitles) * 1 : 0);
    }

    score = Math.min(Math.round(score * 10) / 10, 5);

    return {
        score: score,
        maxScore: 5,
        ownedCount: ownedCount,
        totalCount: totalCount
    };
}

// 計算綜合評分
function calculateEquipmentScore(itemDetails, boardData, petInsight, skillData, titleData) {
    // 1. 裝備品階分數
    const rarity = calculateEquipmentRarityScore(itemDetails);

    // 2. 古文石強化等級分數 (不再獨立計分，因為已由品階含概?)
    // 註：品階分數已包含 Exceed Bonus，這裡只是為了顯示而計算
    const magicStone = calculateMagicStoneScore(itemDetails);

    // 3. 板塊數量分數
    const board = calculateBoardScore(boardData);

    // 4. 寵物理解度分數
    const petInsightResult = calculatePetInsightScore(petInsight);

    // 5. 技能烙印數量分數
    const stigma = calculateStigmaScore(skillData);

    // 6. 稱號數量分數
    const title = calculateTitleScore(titleData);

    // === 指數加權評分系統 (總計100分) ===

    // rarity.score 是所有裝備的得分總和
    // 滿分修正：540 分
    // 1. 武防 8 件 + 可突破飾品 8 件 (項鍊x2/耳環x2/戒指x2/手鐲x2) = 16 件可突破
    //    - 滿強度 (神話+20/突破+5/閃耀) = 32.0 × 16 = 512 分
    // 2. 不可突破飾品 4 件 (腰帶/護身符/古文石x2)
    //    - 腰帶/護身符 (傳說+10) = 10.0 × 2 = 20 分
    //    - 古文石 (特殊+10) = 3.6 × 2 = 7.2 分
    // 總計約 539.2 分 -> 取 540 為滿分基準
    const rarityConverted = Math.min(Math.round((rarity.score / 540) * 30 * 10) / 10, 30);

    // 2. 板塊數量 (15分) - 權重計算
    const boardConverted = (typeof window.isExcludeBoardStats === 'function' && window.isExcludeBoardStats())
        ? 0
        : Math.min(board.score, 15);

    // 3. 寵物理解度 (20分)
    const petConverted = Math.min(petInsightResult.score, 20);

    // 4. 技能烙印 (30分)
    // 已經在 calculateStigmaScore 內計算了 30 分制的 score
    const stigmaConverted = Math.min(stigma.score, 30);

    // 5. 稱號數量 (5分)
    // 已在 calculateTitleScore 內計算分段權重分數
    const titleConverted = title.score;

    // 計算總分（滿分100）
    const totalScore = Math.round((rarityConverted + boardConverted + petConverted + stigmaConverted + titleConverted) * 10) / 10;

    // 滿分100
    const maxScore = 100;
    const percentage = Math.min(Math.round((totalScore / maxScore) * 100), 100);

    // 評級標準 (百分比)
    let grade = 'F';
    if (percentage >= 90) grade = 'SSS';
    else if (percentage >= 80) grade = 'SS';
    else if (percentage >= 70) grade = 'S';
    else if (percentage >= 60) grade = 'A';
    else if (percentage >= 50) grade = 'B';
    else if (percentage >= 40) grade = 'C';
    else if (percentage >= 30) grade = 'D';
    else if (percentage >= 15) grade = 'E';
    else grade = 'F';

    const result = {
        totalScore: totalScore,
        maxScore: maxScore,
        percentage: percentage,
        grade: grade,
        breakdown: {
            rarity: {
                score: rarityConverted,
                maxScore: 30,
                rawScore: rarity.score,
                details: rarity.details
            },
            board: {
                score: boardConverted,
                maxScore: 15,
                rawScore: board.rawScore,
                maxRawScore: board.maxRawScore,
                totalBoards: board.totalBoards,
                details: board.details
            },
            petInsight: {
                score: petConverted,
                maxScore: 20,
                totalClean: petInsightResult.totalClean,
                maxRawScore: petInsightResult.maxRawScore,
                details: petInsightResult.details
            },
            stigma: {
                score: stigmaConverted,
                maxScore: 30,
                rawScore: stigma.rawScore,
                totalPoints: stigma.rawScore,
                maxRawScore: stigma.maxRawScore,
                details: stigma.details
            },
            title: {
                score: titleConverted,
                maxScore: 5,
                ownedCount: title.ownedCount,
                maxRawScore: title.totalCount || 400,
                totalCount: title.totalCount || 400
            }
        }
    };

    // 獲取分析建議
    result.analysis = getScoreAnalysis(result.breakdown);

    return result;
}
// 獲取評分分析建議 (基於新評分系統: 裝備30分+板塊15分+寵物20分+技能30分+稱號5分)
// 獲取評分分析建議 (基於新評分系統: 裝備30分+板塊15分+寵物20分+技能30分+稱號5分)
function getScoreAnalysis(breakdown) {
    const suggestions = [];
    if (!breakdown) return suggestions;

    // === 1. 裝備強度分析 (30分,基於指數加權系統) ===
    const rarity = breakdown.rarity || { score: 0, maxScore: 30, details: [] };
    const equipScore = rarity.score || 0;
    const equipMaxScore = 30; // 固定為 30 分
    const equipPercentage = (equipScore / equipMaxScore) * 100;
    const equipDetails = Array.isArray(rarity.details) ? rarity.details : [];

    // 統計裝備狀況
    let totalEquipCount = 0;
    let mythicCount = 0;
    let legendaryCount = 0;
    let underEnchant15 = 0;
    let underEnchant20 = 0;
    let breakthroughCount = 0;
    let breakthrough5Count = 0;
    let shiningCount = 0;

    equipDetails.forEach(item => {
        if (!item) return;
        const itemName = item.name || '';
        // 排除非裝備類
        if (itemName.includes('古文石') || itemName.includes('護身符')) return;

        totalEquipCount++;
        if (item.rarityKey === 'mythic' || (item.name && (item.name.includes('神話') || item.name.includes('古代')))) mythicCount++;
        if (item.rarityKey === 'legendary') legendaryCount++;
        if (item.isShining) shiningCount++;

        const pureEnchant = item.pureEnchantLevel || 0;
        const exceed = item.exceedLevel || 0;

        if (pureEnchant < 15) underEnchant15++;
        if (pureEnchant < 20) underEnchant20++;
        if (exceed > 0) breakthroughCount++;
        if (exceed >= 5) breakthrough5Count++;
    });

    // 裝備建議邏輯
    const breakableTarget = 16; // 核心可突破裝備目標數 (武防8+飾品8)

    if (equipPercentage < 50) {
        // 低於50%: 品階與基礎強化問題
        suggestions.push({
            title: '🎯 裝備基礎建設',
            desc: `裝備評分僅 <b style="color: #ffd700;">${equipScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${equipPercentage.toFixed(0)}%</b>)。建議優先：<br>1. 將主要裝備升級至「神話」或「傳說」品階<br>2. 全身裝備強化至 +15 以上<br>3. 神話裝備 <b style="color: #ffd700;">${mythicCount}</b>/<b style="color: #ffd700;">${totalEquipCount}</b> 件，建議至少 10 件`,
            priority: '高'
        });
    } else if (equipPercentage < 70) {
        // 50-70%: 強化與突破問題
        suggestions.push({
            title: '⚡ 裝備強化進階',
            desc: `裝備評分 <b style="color: #ffd700;">${equipScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${equipPercentage.toFixed(0)}%</b>)。建議：<br>1. 將核心裝備強化至 +20 (目前 <b style="color: #ffd700;">${Math.max(0, totalEquipCount - underEnchant20)}</b> 件達標)<br>2. 開始進行突破強化 (目前 <b style="color: #ffd700;">${breakthroughCount}</b> 件有突破)<br>3. 優先突破武器、胸甲等核心部位`,
            priority: '高'
        });
    } else if (equipPercentage < 85) {
        // 70-85%: 突破深化
        suggestions.push({
            title: '🚀 裝備突破深化',
            desc: `裝備評分 <b style="color: #ffd700;">${equipScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${equipPercentage.toFixed(0)}%</b>)。建議：<br>1. 擴大突破裝備數量 (目前 <b style="color: #ffd700;">${breakthroughCount}</b>/<b style="color: #ffd700;">${totalEquipCount}</b> 件)<br>2. 將核心裝備推向突破 +5 (目前 <b style="color: #ffd700;">${breakthrough5Count}</b> 件)<br>3. 尋找閃耀裝備以獲得額外加成`,
            priority: '中'
        });
    } else if (equipPercentage < 95) {
        // 85-95%: 極限優化
        suggestions.push({
            title: '💎 裝備極限優化',
            desc: `裝備評分 <b style="color: #ffd700;">${equipScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${equipPercentage.toFixed(0)}%</b>)，已達高水準！建議：<br>1. 將所有可突破裝備推向 +5 (目標 <b style="color: #ffd700;">${breakableTarget}</b> 件，目前 <b style="color: #ffd700;">${breakthrough5Count}</b> 件)<br>2. 追求全身神話+閃耀組合<br>3. 優化飾品品階與突破等級`,
            priority: '低'
        });
    } else {
        // 95%+: 完美
        suggestions.push({
            title: '⚔️ 裝備巔峰',
            desc: `裝備評分 <b style="color: #ffd700;">${equipScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${equipPercentage.toFixed(0)}%</b>)，已達頂尖水準！${breakthrough5Count >= breakableTarget ? '全身核心裝備突破 +5，' : ''}屬於全服前段班。`,
            priority: '無'
        });
    }

    // === 2. 板塊分析 (15分,權重計算) ===
    const board = breakdown.board || { score: 0, details: [] };
    const boardScore = board.score || 0;
    const boardPercentage = (boardScore / 15) * 100;

    if (boardPercentage < 60) {
        suggestions.push({
            title: '📋 板塊核心建設',
            desc: `板塊評分 <b style="color: #ffd700;">${boardScore.toFixed(1)}</b>/15 (<b style="color: #ffd700;">${boardPercentage.toFixed(0)}%</b>)。優先解鎖前四板塊（奈薩肯、吉凱爾、白傑爾、崔妮爾）至 80% 以上，這是性價比最高的選擇。`,
            priority: '高'
        });
    } else if (boardPercentage < 80) {
        suggestions.push({
            title: '📋 板塊進階衝刺',
            desc: `板塊評分 <b style="color: #ffd700;">${boardScore.toFixed(1)}</b>/15 (<b style="color: #ffd700;">${boardPercentage.toFixed(0)}%</b>)。核心四板已有基礎，建議挑戰「瑪爾庫坦」(3.0分) 與「艾瑞爾」(2.0分) 以獲取加成，最終目標為「阿斯佩爾」(4.0分)。`,
            priority: '中'
        });
    } else if (boardPercentage < 95) {
        suggestions.push({
            title: '📋 板塊完善',
            desc: `板塊評分 <b style="color: #ffd700;">${boardScore.toFixed(1)}</b>/15 (<b style="color: #ffd700;">${boardPercentage.toFixed(0)}%</b>)。建議將所有板塊推向 100% 完成度以榨取最後的屬性加成。`,
            priority: '低'
        });
    } else {
        suggestions.push({
            title: '📋 板塊大師',
            desc: `板塊評分 <b style="color: #ffd700;">${boardScore.toFixed(1)}</b>/15 (<b style="color: #ffd700;">${boardPercentage.toFixed(0)}%</b>)，六大板塊已臻完美！`,
            priority: '無'
        });
    }

    // === 3. 寵物理解度分析 (20分,8種理解度) ===
    const pet = breakdown.petInsight || { score: 0, totalClean: 0 };
    const petScore = pet.score || 0;
    const petPercentage = (petScore / 20) * 100;
    const petClean = pet.totalClean || 0;

    if (petPercentage < 50) {
        suggestions.push({
            title: '🐾 寵物探險啟動',
            desc: `寵物評分 <b style="color: #ffd700;">${petScore.toFixed(1)}</b>/20 (<b style="color: #ffd700;">${petPercentage.toFixed(0)}%</b>)。建議持續派遣探險隊，優先將單一類別（智慧/野性/自然/變身）的所有寵物提升至 L3。`,
            priority: '中'
        });
    } else if (petPercentage < 80) {
        suggestions.push({
            title: '🐾 寵物深化培養',
            desc: `寵物評分 <b style="color: #ffd700;">${petScore.toFixed(1)}</b>/20 (<b style="color: #ffd700;">${petPercentage.toFixed(0)}%</b>)。建議將更多寵物推向 L4，並平衡發展四大類別以最大化評分。`,
            priority: '中'
        });
    } else if (petPercentage < 95) {
        suggestions.push({
            title: '🐾 寵物精通',
            desc: `寵物評分 <b style="color: #ffd700;">${petScore.toFixed(1)}</b>/20 (<b style="color: #ffd700;">${petPercentage.toFixed(0)}%</b>)。已達成 <b style="color: #ffd700;">${petClean.toFixed(1)}</b>/8 階，繼續完善剩餘類別即可滿分。`,
            priority: '低'
        });
    } else {
        suggestions.push({
            title: '🐾 寵物大師',
            desc: `寵物評分 <b style="color: #ffd700;">${petScore.toFixed(1)}</b>/20 (<b style="color: #ffd700;">${petPercentage.toFixed(0)}%</b>)，寵物理解度已達巔峰！`,
            priority: '無'
        });
    }

    // === 4. 技能烙印分析 (30分,階梯式積分) ===
    const stigma = breakdown.stigma || { score: 0, totalPoints: 0 };
    const stigmaScore = stigma.score || 0;
    const stigmaIntensity = stigma.totalPoints || 0;
    const stigmaPercentage = (stigmaScore / 30) * 100;

    if (stigmaPercentage < 80) {
        // 低於24分(80%)
        const target = 400; // 核心目標強度
        const remaining = Math.max(0, target - stigmaIntensity);
        suggestions.push({
            title: '⚔️ 技能烙印核心',
            desc: `技能評分 <b style="color: #ffd700;">${stigmaScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${stigmaPercentage.toFixed(0)}%</b>)，當前強度 <b style="color: #ffd700;">${stigmaIntensity}</b>/1200。建議將 4 招常用核心技能烙印至 Lv.20（總強度 400），即可達到 24 分（80%），${remaining > 0 ? `還需 <b style="color: #ffd700;">${remaining}</b> 強度` : '已達核心目標'}。`,
            priority: stigmaPercentage < 50 ? '高' : '中'
        });
    } else if (stigmaPercentage < 95) {
        // 24-28.5分
        suggestions.push({
            title: '⚔️ 技能烙印進階',
            desc: `技能評分 <b style="color: #ffd700;">${stigmaScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${stigmaPercentage.toFixed(0)}%</b>)，當前強度 <b style="color: #ffd700;">${stigmaIntensity}</b>/1200。核心技能已達標，可繼續提升更多技能至 Lv.20 以追求滿分（需 1200 強度）。`,
            priority: '低'
        });
    } else {
        suggestions.push({
            title: '⚔️ 烙印大師',
            desc: `技能評分 <b style="color: #ffd700;">${stigmaScore.toFixed(1)}</b>/30 (<b style="color: #ffd700;">${stigmaPercentage.toFixed(0)}%</b>)，技能烙印已達頂尖水準！`,
            priority: '無'
        });
    }

    // === 5. 稱號分析 (5分,分段權重) ===
    const title = breakdown.title || { score: 0, ownedCount: 0, totalCount: 400 };
    const titleScore = title.score || 0;
    const titleCount = title.ownedCount || 0;
    const titleTotal = title.totalCount || 400;
    const titlePercentage = (titleScore / 5) * 100;

    if (titlePercentage < 80) {
        // 低於4分
        const target = Math.floor(titleTotal * 0.5);
        suggestions.push({
            title: '🏅 稱號蒐集',
            desc: `稱號評分 <b style="color: #ffd700;">${titleScore.toFixed(1)}</b>/5 (<b style="color: #ffd700;">${titlePercentage.toFixed(0)}%</b>)，當前 <b style="color: #ffd700;">${titleCount}</b>/${titleTotal} 個。達成 50% (<b style="color: #ffd700;">${target}</b> 個) 即可獲得 4 分（80%），這是性價比最高的目標。`,
            priority: '低'
        });
    } else if (titlePercentage < 95) {
        suggestions.push({
            title: '🏅 稱號收藏家',
            desc: `稱號評分 <b style="color: #ffd700;">${titleScore.toFixed(1)}</b>/5 (<b style="color: #ffd700;">${titlePercentage.toFixed(0)}%</b>)，當前 <b style="color: #ffd700;">${titleCount}</b>/${titleTotal} 個。繼續收集稀有稱號以達到滿分。`,
            priority: '低'
        });
    } else {
        suggestions.push({
            title: '🏆 稱號大師',
            desc: `稱號評分 <b style="color: #ffd700;">${titleScore.toFixed(1)}</b>/5 (<b style="color: #ffd700;">${titlePercentage.toFixed(0)}%</b>)，稱號收集已超越絕大多數玩家！`,
            priority: '無'
        });
    }

    // === 6. 綜合評價 ===
    const totalScore = (equipScore + boardScore + petScore + stigmaScore + titleScore);

    if (totalScore >= 95) {
        suggestions.unshift({
            title: '👑 完美機體',
            desc: `總評分 <b style="color: #ffd700;">${totalScore.toFixed(1)}</b>/100，您的機體已全面達到頂尖水準，裝備、板塊、寵物、技能、稱號皆已臻至完美，屬於全服最強梯隊！`,
            priority: '無'
        });
    } else if (totalScore >= 85) {
        suggestions.unshift({
            title: '🌟 精英水準',
            desc: `總評分 <b style="color: #ffd700;">${totalScore.toFixed(1)}</b>/100，您的機體已達精英水準，繼續優化弱項即可邁向完美！`,
            priority: '無'
        });
    } else if (totalScore >= 70) {
        suggestions.unshift({
            title: '💪 穩健發展',
            desc: `總評分 <b style="color: #ffd700;">${totalScore.toFixed(1)}</b>/100，機體發展穩健，建議優先提升評分較低的項目以快速提升總分。`,
            priority: '無'
        });
    } else if (totalScore >= 50) {
        suggestions.unshift({
            title: '🔧 成長階段',
            desc: `總評分 <b style="color: #ffd700;">${totalScore.toFixed(1)}</b>/100，您的機體還有很大的成長空間。建議從裝備強化和板塊解鎖開始，這兩項是提升戰力最快的途徑！`,
            priority: '高'
        });
    } else {
        suggestions.unshift({
            title: '🌱 新手起步',
            desc: `總評分 <b style="color: #ffd700;">${totalScore.toFixed(1)}</b>/100，歡迎來到永恆之塔！建議優先將主要裝備提升至+15，並開始解鎖板塊。`,
            priority: '高'
        });
    }

    return suggestions;
}

// 獲取評級顏色
function getScoreGradeColor(grade) {
    const colors = {
        'SSS': '#ff0000',  // 紅色
        'SS': '#ff6b35',   // 橙紅色
        'S': '#ffa500',    // 橙色
        'A': '#ffd700',    // 金色
        'B': '#00d4ff',    // 藍色
        'C': '#00ff88',    // 綠色
        'D': '#bdc3c7',    // 淺灰色
        'E': '#95a5a6',    // 灰藍色
        'F': '#7f8c8d'     // 灰色
    };
    return colors[grade] || '#888888';
}
