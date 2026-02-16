// 角色實力綜合評分系統
// 基於多個維度計算角色的整體實力分數

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
    if (hasFetchedExternalDB) return; // 避免重複請求

    console.log('正在從 QuestLog 同步物品資料庫...');

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
            // 轉為 URL 編碼字串
            const inputStr = encodeURIComponent(JSON.stringify(input));
            const targetUrl = `https://questlog.gg/aion-2/api/trpc/database.getItems?input=${inputStr}`;
            const proxyUrl = `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(targetUrl)}`;

            requests.push(
                fetch(proxyUrl)
                    .then(res => res.json())
                    .then(data => {
                        // 解析 TRPC 回傳結構 (result.data.json.items)
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
        // 合併所有結果
        results.flat().forEach(item => {
            if (item && item.name) {
                // 建立映射: 名稱 -> 詳細資訊 (包含品階 quality)
                EXTERNAL_ITEM_DB[item.name] = {
                    quality: item.quality,
                    grade: item.grade,
                    level: item.level
                };
            }
        });

        hasFetchedExternalDB = true;
        console.log(`QuestLog 資料庫同步完成，共 ${Object.keys(EXTERNAL_ITEM_DB).length} 筆資料`);

        // 觸發重新渲染 (如果已經有資料的話)
        // 注意: 這裡假設全域有 renderEquipment 函數，若無則忽略
        if (typeof window.renderEquipment === 'function') {
            console.log("重新計算並渲染裝備...");
            window.renderEquipment();
        }

    } catch (e) {
        console.error("QuestLog Sync Failed:", e);
    }
}

// 取得單件裝備的品階資訊 (供外部調用)
function getEquipmentRarityInfo(item) {
    if (!item || !item.detail) return null;

    const d = item.detail;
    const name = d.name || '';
    const rawGrade = (d.quality || d.grade || '').toLowerCase();

    // 決定正規化品階 Key
    let rarityKey = 'common';
    let source = 'keyword'; // 來源標記: keyword 或 db

    // 0. 優先檢查外部資料庫 (QuestLog)
    if (EXTERNAL_ITEM_DB[name]) {
        const dbItem = EXTERNAL_ITEM_DB[name];
        const dbQuality = (dbItem.quality || dbItem.grade || '').toLowerCase();

        if (dbQuality.includes('mythic') || dbQuality.includes('ancient') || dbQuality === '神話' || dbQuality === '古代') {
            rarityKey = 'mythic';
        } else if (dbQuality.includes('unique') || dbQuality === '唯一' || dbQuality === '獨特') {
            rarityKey = 'legendary'; // 使用者要求：Unique -> 金色
        } else if (dbQuality.includes('legend') || dbQuality.includes('eternal') || dbQuality === '傳說' || dbQuality === '傳承' || dbQuality === '史詩' || dbQuality.includes('epic')) {
            rarityKey = 'epic'; // 使用者要求：Legend -> 藍色
        } else if (dbQuality.includes('rare') || dbQuality === '稀有') {
            rarityKey = 'rare';
        } else if (dbQuality.includes('special') || dbQuality === '特殊') {
            rarityKey = 'special';
        }

        if (rarityKey !== 'common') source = 'db';
    }

    // 如果外部資料庫沒找到，或只找到普通，則使用關鍵字判斷 (Fallback)
    if (rarityKey === 'common') {
        const lowerName = name.toLowerCase();

        // 數值 Grade 判斷 (QuestLog ID 系統)
        const gradeNum = parseInt(d.grade || d.quality || 0);
        if (gradeNum >= 51) {
            rarityKey = 'mythic'; // grade 51+ = Ancient/Mythic
        } else if (gradeNum >= 50) {
            rarityKey = 'legendary'; // grade 50 = Legendary
        } else if (gradeNum >= 40) {
            rarityKey = 'epic'; // grade 40+ = Epic/Unique
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

    itemDetails.forEach(item => {
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
            const enchantLevel = d.enchantLevel || 0;
            const totalEnchant = exceedLevel + enchantLevel; // 用於顯示

            // 強化加成 = 基礎分 × (強化等級 / 20)^1.2
            const enchantRatio = enchantLevel / 20;
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
                enchantLevel: totalEnchant,  // 顯示用：強化+突破總和
                pureEnchantLevel: enchantLevel,  // 分析用：純強化等級
                exceedLevel: exceedLevel,
                isShining: info.isShining,
                enchantBonus: Math.round(enchantBonus * 10) / 10,
                exceedBonus: Math.round(exceedBonus * 10) / 10,
                shineBonus: Math.round(shineBonus * 10) / 10,
                score: itemRawScore,  // 單件得分
                color: info.color
            });
        }
    });

    // 排序: 分數高到低
    details.sort((a, b) => b.score - a.score);

    // 返回總分（用於最終評分計算）
    // 滿分：12件神話+20+5突破閃耀 = 12 × 32 = 384分
    return {
        score: totalConvertedScore,  // 總分
        maxScore: 384,  // 滿分
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

    itemDetails.forEach(item => {
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

    // 定義權重 (總計 15 分)
    const weightMap = {
        '奈薩肯': 1.5,
        '吉凱爾': 1.5,
        '白傑爾': 1.5,
        '崔妮爾': 1.5,
        '艾瑞爾': 4.0,  // 困難 (PVE/PVP)
        '阿斯佩爾': 5.0 // 極難
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

            // 計算該板塊得分: (已解鎖 / 總數) * 權重
            // 避免除以0
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

    // 返回結構包含加權後的總分 (0-15)
    return {
        score: finalScore,        // 加權後的總分
        rawScore: totalNodes,     // 原始總板塊數
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
            // 嚴格過濾：排除主動與被動技能，只計算烙印 (Stigma/AdvancedStigma)
            if (skill.category === 'Active' || skill.category === 'Passive') return;

            let level = 0;
            // 優先級偵測：level > skillLevel > enchantLevel
            if (skill.level) level = skill.level;
            else if (skill.skillLevel) level = skill.skillLevel;
            else if (skill.enchantLevel) level = skill.enchantLevel;

            // 移除模糊搜尋，因為可能抓到 learnLevel 或 maxLevel (導致沒學的技能顯示 Lv22)

            // 排除等級為 0 的技能
            if (!level || level <= 0) return;

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
    const boardConverted = Math.min(board.score, 15);

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
                totalBoards: board.totalBoards,
                details: board.details
            },
            petInsight: {
                score: petConverted,
                maxScore: 20,
                totalClean: petInsightResult.totalClean,
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
                totalCount: title.totalCount || 400
            }
        }
    };

    // 獲取分析建議
    result.analysis = getScoreAnalysis(result.breakdown);

    return result;
}
// 獲取評分分析建議 (優先考量突破與核心進度)
function getScoreAnalysis(breakdown) {
    const suggestions = [];

    // 1. 裝備強度分析 (階段性突破目標)
    const equipDetails = breakdown.rarity.details || [];

    // 統計全身裝備的強化與突破狀況（不分品階）
    let totalEquipCount = 0;
    let underEnchant10 = 0;  // 未達 +10
    let breakthroughCount = 0;  // 有突破的件數（任意等級）
    let breakthrough2Count = 0;  // 突破達 +2 的件數
    let breakthrough5Count = 0;  // 突破達 +5 的件數

    equipDetails.forEach(item => {
        // 排除古文石（古文石不計入裝備統計）
        const itemName = item.name || '';
        const isMagicStone = itemName.includes('古文石');
        if (isMagicStone) return;

        // equipDetails 已經過濾過了，包含所有武防和飾品
        totalEquipCount++;
        const pureEnchantLv = item.pureEnchantLevel || 0;
        const exceedLv = item.exceedLevel || 0;

        if (pureEnchantLv < 10) underEnchant10++;
        if (exceedLv > 0) breakthroughCount++;
        if (exceedLv >= 2) breakthrough2Count++;
        if (exceedLv >= 5) breakthrough5Count++;
    });

    // 階段性目標判定
    // 階段 1：80% 裝備 +10 + 2 件突破 +2
    const enchant10Rate = totalEquipCount > 0 ? (totalEquipCount - underEnchant10) / totalEquipCount : 0;

    if (enchant10Rate < 0.8 || breakthrough2Count < 2) {
        let desc = '';
        if (enchant10Rate < 0.8 && breakthrough2Count < 2) {
            desc = `目前有 ${underEnchant10} 件裝備未達 +10（${totalEquipCount} 件中），且僅有 ${breakthrough2Count} 件達到突破 +2。建議先將 80% 以上裝備強化至 +10，並至少完成 2 件裝備的突破 +2。`;
        } else if (enchant10Rate < 0.8) {
            desc = `目前有 ${underEnchant10} 件裝備未達 +10（${totalEquipCount} 件中）。建議優先將 80% 以上裝備強化至 +10 以建立基礎戰力。`;
        } else {
            desc = `目前僅有 ${breakthrough2Count} 件裝備達到突破 +2。建議至少完成 2 件核心部位（武器、胸甲）的突破 +2。`;
        }

        suggestions.push({
            title: '🎯 階段一：建立基礎',
            desc: desc,
            priority: '高'
        });
    }
    // 階段 2：4 件以上突破，目標 10 件突破 +2
    else if (breakthroughCount < 4 || breakthrough2Count < 10) {
        let desc = '';
        if (breakthroughCount < 4) {
            desc = `目前僅有 ${breakthroughCount} 件裝備有突破。建議優先將更多裝備進行突破，目標是至少 10 件達到突破 +2。`;
        } else {
            desc = `目前有 ${breakthrough2Count} 件裝備達到突破 +2（目標 10 件）。建議持續擴展突破裝備的數量，全面提升戰力。`;
        }

        suggestions.push({
            title: '� 階段二：擴展突破',
            desc: desc,
            priority: '高'
        });
    }
    // 階段 3：10 件以上突破 +2，目標突破 +5
    else if (breakthrough2Count >= 10 && breakthrough5Count < 6) {
        suggestions.push({
            title: '� 階段三：追求極限',
            desc: `已有 ${breakthrough2Count} 件裝備達到突破 +2，目前有 ${breakthrough5Count} 件達到突破 +5。建議開始將核心裝備推向突破 +5，進入頂尖水準。`,
            priority: '中'
        });
    }

    // 2. 板塊分析 (先核心四板)
    const boardDetails = breakdown.board.details || [];
    const core4Names = ['奈薩肯', '吉凱爾', '白傑爾', '崔妮爾'];
    const advancedNames = ['艾瑞爾', '阿斯佩爾'];

    let core4Completion = 0;
    let core4Count = 0;
    let advancedCompletion = 0;
    let advancedCount = 0;

    boardDetails.forEach(b => {
        const name = b.name || '';
        const isCore = core4Names.some(cn => name.includes(cn));
        const isAdvanced = advancedNames.some(an => name.includes(an));
        const progress = b.max > 0 ? (b.count / b.max) : 0;

        if (isCore) {
            core4Completion += progress;
            core4Count++;
        } else if (isAdvanced) {
            advancedCompletion += progress;
            advancedCount++;
        }
    });

    const avgCore4 = core4Count > 0 ? core4Completion / core4Count : 0;
    const avgAdvanced = advancedCount > 0 ? advancedCompletion / advancedCount : 0;

    if (avgCore4 < 0.8) {
        suggestions.push({
            title: '📋 板塊核心',
            desc: '前四個板塊（奈薩肯至崔妮爾）是奠定基礎的重點，建議優先將這四個解鎖至 80% 以上。',
            priority: '高'
        });
    } else if (avgAdvanced < 0.6) {
        suggestions.push({
            title: '📋 板塊進階',
            desc: '核心板塊已達標！建議開始衝刺「艾瑞爾」與「阿斯佩爾」，以獲取頂級的屬性加成。',
            priority: '中'
        });
    }

    // 3. 寵物分析
    if (breakdown.petInsight.score < 14) {
        suggestions.push({
            title: '🐾 寵物探險',
            desc: '寵物理解度的 L3/L4 達成率尚有提升空間。請確保探險隊產出，優先達成單一類別的全 L3。',
            priority: '中'
        });
    }

    // 4. 技能分析（4 招核心技能即可）
    if (breakdown.stigma.score < 24) {
        const currentIntensity = breakdown.stigma.totalPoints || 0;
        suggestions.push({
            title: '⚔️ 技能烙印',
            desc: `目前技能強度為 ${currentIntensity}/1200。建議將 4 招常用核心技能烙印至 Lv.20（總強度 400），即可達到 80% 分數，無需全滿。`,
            priority: '低'
        });
    }


    // 5. 稱號分析
    if (breakdown.title.score < 4) {
        const currentCount = breakdown.title.ownedCount;
        const targetCount = Math.floor(breakdown.title.totalCount * 0.5);
        suggestions.push({
            title: '🏅 稱號蒐集',
            desc: `目前稱號數量 (${currentCount}) 尚未達標一半 (${targetCount})。達成 50% 總量即可拿滿 80% 分數。`,
            priority: '低'
        });
    } else if (breakdown.title.score >= 4.8) {
        // 接近滿分（96%+）
        suggestions.push({
            title: '🏆 稱號大師',
            desc: `稱號收集已達頂尖水準！目前擁有 ${breakdown.title.ownedCount} 個稱號，已超越絕大多數玩家。`,
            priority: '無'
        });
    }

    // === 各項目完美狀態判定 ===

    // 裝備完美：10 件以上突破 +2，且 6 件以上突破 +5
    if (breakthrough2Count >= 10 && breakthrough5Count >= 6) {
        suggestions.push({
            title: '⚔️ 裝備巔峰',
            desc: `裝備已達頂尖！，${breakthrough5Count} 件突破 +5，屬於全服前段班水準。`,
            priority: '無'
        });
    }

    // 板塊完美：核心四板 >= 95% 且進階兩板 >= 80%
    if (avgCore4 >= 0.95 && avgAdvanced >= 0.8) {
        suggestions.push({
            title: '📋 板塊完成',
            desc: '板塊進度已達極致！核心與進階板塊皆已高度完成。',
            priority: '無'
        });
    }

    // 寵物完美：分數 >= 18（90%）
    if (breakdown.petInsight.score >= 18) {
        suggestions.push({
            title: '🐾 寵物精通',
            desc: '寵物等級已達90%總數LV4以上！請持續精進自己的寵物理解度。',
            priority: '無'
        });
    }

    // 技能完美：分數 >= 27（90%）
    if (breakdown.stigma.score >= 27) {
        suggestions.push({
            title: '⚔️ 烙印大師',
            desc: '您擁有4個LV20技能烙印，強度分數超越 90%，可持續加強拿滿12個LV20烙印技能。',
            priority: '無'
        });
    }

    // 最終判定：所有項目都完美才顯示
    const isPerfectEquip = breakthrough2Count >= 10 && breakthrough5Count >= 6;
    const isPerfectBoard = avgCore4 >= 0.95 && avgAdvanced >= 0.8;
    const isPerfectPet = breakdown.petInsight.score >= 18;
    const isPerfectSkill = breakdown.stigma.score >= 27;
    const isPerfectTitle = breakdown.title.score >= 4.8;

    if (isPerfectEquip && isPerfectBoard && isPerfectPet && isPerfectSkill && isPerfectTitle) {
        suggestions.push({
            title: '👑 完美機體',
            desc: '恭喜！您的機體已全面達到頂尖水準，裝備、板塊、寵物、技能、稱號皆已臻至完美，屬於全服最強梯隊！',
            priority: '無'
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
