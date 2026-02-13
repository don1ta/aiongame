// 角色實力綜合評分系統
// 基於多個維度計算角色的整體實力分數

// 裝備品階設定 (分數、名稱、顏色)
// 裝備品階設定 (分數、名稱、顏色)
// 裝備品階設定 (分數、名稱、顏色)
const RARITY_CONFIG = {
    'mythic': { score: 15, name: '神話', color: '#e67e22' }, // 神話/古代 (橙)
    'legendary': { score: 10, name: '傳說', color: '#f1c40f' }, // 傳說/唯一/獨特 (金)
    'epic': { score: 6, name: '史詩', color: '#3498db' }, // 史詩/傳承 (藍)
    'special': { score: 4, name: '特殊', color: '#00ffcc' }, // 特殊 (青)
    'rare': { score: 3, name: '稀有', color: '#2ecc71' }, // 稀有 (綠)
    'common': { score: 1, name: '普通', color: '#ffffff' } // 普通 (白)
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

        // 1. 優先檢查 API grade (根據使用者要求的對應關係)
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

        // 2. 名稱關鍵字判斷 (作為補充)
        if (rarityKey === 'common') {
            if (lowerName.includes('霸龍') || lowerName.includes('應龍') || lowerName.includes('神話') || lowerName.includes('古代')) {
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
    if (baseScore === 0 && isShining) {
        baseScore = 3;
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

    let totalScore = 0;
    let details = [];

    itemDetails.forEach(item => {
        const d = item.detail;
        if (!d || !d.name) return;

        const slot = item.slotPos;
        // 判定範圍: 1-8(防具), 21(盾?), 9-20(飾品/翅膀?), 22-40(其他飾品)
        const isArmor = (slot >= 1 && slot <= 8) || slot === 21;
        const isAccessory = (slot >= 9 && slot <= 20) || (slot >= 22 && slot <= 40);

        // 只計算武防和飾品 (含翅膀 slot 15)
        if (!isArmor && !isAccessory) return;

        // 使用共用邏輯取得品階資訊
        const info = getEquipmentRarityInfo(item);
        if (!info) return;

        if (info.baseScore > 0 || info.rarityKey !== 'common') {
            // 新計算方式: 分數 = 品階基礎分 × (1 + 強化加權比例 + 閃耀加成)
            const baseScore = info.baseScore;

            // 強化權重計算 (階梯式加權)
            // 突破等級 (exceedLevel): 權重 2.0 (每級算2級)
            // 一般強化 (enchantLevel):
            //   Lv 0-10: 權重 1.0
            //   Lv 11-15: 權重 1.2
            //   Lv 16+: 權重 1.5

            const exceedLevel = item.exceedLevel || 0;
            const enchantLevel = d.enchantLevel || 0;

            let weightedEnchant = 0;

            // 計算一般強化加權
            if (enchantLevel <= 10) {
                weightedEnchant += enchantLevel * 1.0;
            } else if (enchantLevel <= 15) {
                weightedEnchant += 10 * 1.0 + (enchantLevel - 10) * 1.2;
            } else {
                weightedEnchant += 10 * 1.0 + 5 * 1.2 + (enchantLevel - 15) * 1.5;
            }

            // 計算突破加權
            weightedEnchant += exceedLevel * 2.0;

            const totalEnchant = exceedLevel + enchantLevel; // 用於顯示總等級

            // 分母維持 25，這意味著高強化裝備的倍率會顯著提升 (>100%)
            const enchantRatio = weightedEnchant / 25;

            // 閃耀加成 10%
            const shineBonus = info.isShining ? 0.1 : 0;

            // 總倍率
            const multiplier = 1 + enchantRatio + shineBonus;

            // 最終分數（4捨2入：小數點 0.0-0.2 捨去，0.3+ 進位）
            const rawScore = baseScore * multiplier;
            const decimal = rawScore - Math.floor(rawScore);
            const itemTotalScore = decimal <= 0.2 ? Math.floor(rawScore) : Math.ceil(rawScore);

            totalScore += itemTotalScore;

            details.push({
                name: d.name,
                dragonType: info.name,
                baseScore: baseScore,
                enchantLevel: totalEnchant,
                isShining: info.isShining,
                multiplier: multiplier.toFixed(2),
                score: itemTotalScore,
                color: info.color
            });
        }
    });

    // 排序: 分數高到低
    details.sort((a, b) => b.score - a.score);

    // 階梯式計分: 每100分+1級，上限5分
    let score = 0;
    if (totalScore >= 500) score = 5;
    else if (totalScore >= 400) score = 4;
    else if (totalScore >= 300) score = 3;
    else if (totalScore >= 200) score = 2;
    else if (totalScore >= 100) score = 1;

    // 滿分固定為 5 分
    const maxScore = 5;

    return { score: score, maxScore: maxScore, rawScore: totalScore, details: details };
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
        return { score: 0, totalBoards: 0, maxScore: 0 };
    }

    let totalNodes = 0;
    let maxNodes = 0;
    let details = [];

    // 計算所有板塊的已解鎖總數 (直接加總 openNodeCount)
    boardData.forEach(board => {
        if (board && typeof board.openNodeCount === 'number') {
            const count = board.openNodeCount;
            const total = board.totalNodeCount || 0;

            totalNodes += count;
            maxNodes += total;

            details.push({
                name: board.name,
                count: count,
                max: total
            });
        }
    });

    // 階梯式計分: 每100個節點+1分，上限5分
    let score = 0;
    if (totalNodes >= 500) score = 5;
    else if (totalNodes >= 400) score = 4;
    else if (totalNodes >= 300) score = 3;
    else if (totalNodes >= 200) score = 2;
    else if (totalNodes >= 100) score = 1;

    // 滿分固定為 5 分
    const maxScore = 5;

    return { score: score, maxScore: maxScore, totalBoards: totalNodes, details: details };
}

// 計算寵物理解度分數
// 計算寵物理解度分數
function calculatePetInsightScore(petInsight) {
    if (!petInsight || typeof petInsight !== 'object') {
        return { score: 0, level3Count: 0, level4Count: 0 };
    }

    let score = 0;
    // 用於顯示資訊，雖然分數不再直接依賴數量，但保留統計數據可能有用
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

        let typeScore = 0;
        if (total > 0) {
            // 滿寵 (所有寵物都達到 3 等)
            if (lv3 >= total) {
                score += 1;
                typeScore += 1;
            }
            // 滿寵 (所有寵物都達到 4 等)
            if (lv4 >= total) {
                score += 1;
                typeScore += 1;
            }
        }

        details.push({
            type: type,
            total: total,
            lv3: lv3,
            lv4: lv4,
            score: typeScore
        });
    });

    return {
        score: score,
        maxScore: 8,
        level3Count: totalLevel3,
        level4Count: totalLevel4,
        details: details
    };
}

// 計算技能烙印分數（新版：等級 = 分數）
function calculateStigmaScore(skillData) {
    if (!skillData || typeof skillData !== 'object') {
        return { score: 0, maxScore: 10, rawScore: 0, maxRawScore: 40, count: 0, details: [] };
    }

    let totalLevel = 0;
    let count = 0;
    let details = [];

    if (skillData.stigma && Array.isArray(skillData.stigma)) {
        skillData.stigma.forEach(skill => {
            // 排除主動與被動技能，只計算特殊/烙印技能
            if (skill.category === 'Active' || skill.category === 'Passive') return;

            // 優先使用 skillLevel (API特定)，若無則使用 enchantLevel
            let level = 0;
            let hasFoundLevel = false;

            if (skill.skillLevel !== undefined && skill.skillLevel !== null) {
                level = skill.skillLevel;
                hasFoundLevel = true;
            } else if (skill.enchantLevel !== undefined && skill.enchantLevel !== null) {
                level = skill.enchantLevel;
                hasFoundLevel = true;
            }

            // 如果透過標準屬性沒抓到，嘗試模糊搜尋
            if (!hasFoundLevel) {
                for (const key in skill) {
                    if (/enchant|point/i.test(key) && typeof skill[key] === 'number') {
                        level = skill[key];
                        break;
                    }
                }
            }

            if (level > 0) {
                totalLevel += level;
                count++;
                details.push({
                    name: skill.name,
                    level: level,
                    score: level  // 等級 = 分數
                });
            }
        });
    }

    // 排序: 等級高到低
    details.sort((a, b) => b.level - a.level);

    // 原始分數就是總等級
    const rawScore = totalLevel;

    // 計算最終分數（轉換為10分制）
    // 滿分標準：12個技能 × Lv20 = 240分 → 10分
    let score = Math.round((rawScore / 240) * 10);
    if (score > 10) score = 10;

    const maxScore = 10;
    const maxRawScore = 240;  // 12個Lv20

    return {
        score: score,
        maxScore: maxScore,
        rawScore: rawScore,
        maxRawScore: maxRawScore,
        count: count,
        details: details
    };
}

// 計算稱號數量分數
function calculateTitleScore(titleData) {
    if (!titleData || typeof titleData !== 'object') {
        return { score: 0, ownedCount: 0, totalCount: 0 };
    }

    const ownedCount = titleData.ownedCount || 0;
    const totalCount = titleData.totalCount || 0;

    // 根據稱號數量計算分數 (每100個 +1分)
    let score = 0;
    if (ownedCount >= 100) score = Math.floor(ownedCount / 100);

    const maxScore = totalCount >= 100 ? Math.floor(totalCount / 100) : 0;

    return {
        score: score,
        maxScore: maxScore,
        ownedCount: ownedCount,
        totalCount: totalCount
    };
}

// 計算綜合評分
function calculateEquipmentScore(itemDetails, boardData, petInsight, skillData, titleData) {
    // 1. 裝備品階分數 (原龍王系列)
    const rarity = calculateEquipmentRarityScore(itemDetails);

    // 2. 古文石強化等級分數
    const magicStone = calculateMagicStoneScore(itemDetails);

    // 3. 板塊數量分數
    const board = calculateBoardScore(boardData);

    // 4. 寵物理解度分數
    const petInsightResult = calculatePetInsightScore(petInsight);

    // 5. 技能烙印數量分數
    const stigma = calculateStigmaScore(skillData);

    // 6. 稱號數量分數
    const title = calculateTitleScore(titleData);

    // === 轉換為100分制 (根據使用者新公式調整權重，總計90分) ===

    // 1. 裝備品階 (30分)
    // 公式: (原始分 / 500) * 30
    const rarityConverted = Math.min(Math.round((rarity.rawScore / 500) * 30 * 10) / 10, 30);

    // 2. 古文石與護身符 (10分)
    // 公式: (強化分 / 60) * 10
    const magicStoneConverted = Math.min(Math.round((magicStone.rawScore / 60) * 10 * 10) / 10, 10);

    // 3. 板塊數量 (15分)
    // 公式: (數量 / 684) * 15
    const boardConverted = Math.min(Math.round((board.totalBoards / 684) * 15 * 10) / 10, 15);

    // 4. 寵物理解度 (10分)
    // 公式: (原始分 / 8) * 10
    // petInsightResult.score 原本是0-8 (滿足條件數)
    const petConverted = Math.min(Math.round((petInsightResult.score / 8) * 10 * 10) / 10, 10);

    // 5. 技能烙印 (20分)
    // 公式: (等級和 / 240) * 20
    const stigmaConverted = Math.min(Math.round((stigma.rawScore / 240) * 20 * 10) / 10, 20);

    // 6. 稱號數量 (5分)
    // 公式: (數量 / 400) * 5
    // 修正: 使用 400 作為基準
    const titleConverted = Math.min(Math.round((title.ownedCount / 400) * 5 * 10) / 10, 5);

    // 計算總分（滿分90）
    const totalScore = Math.round((rarityConverted + magicStoneConverted + boardConverted + petConverted + stigmaConverted + titleConverted) * 10) / 10;

    // 滿分90
    const maxScore = 90;
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

    return {
        totalScore: totalScore,
        maxScore: maxScore,
        percentage: percentage,
        grade: grade,
        breakdown: {
            rarity: {
                score: rarityConverted,
                maxScore: 30,
                rawScore: rarity.rawScore,
                details: rarity.details
            },
            magicStone: {
                score: magicStoneConverted,
                maxScore: 10, // Max 10
                rawScore: Math.round(magicStone.rawScore * 10) / 10,
                count: magicStone.count,
                details: magicStone.details
            },
            board: {
                score: boardConverted,
                maxScore: 15, // Max 15
                totalBoards: board.totalBoards,
                details: board.details
            },
            petInsight: {
                score: petConverted,
                maxScore: 10,
                details: petInsightResult.details
            },
            stigma: {
                score: stigmaConverted,
                maxScore: 20, // Max 20
                rawScore: stigma.rawScore,
                totalPoints: stigma.rawScore,
                maxRawScore: stigma.maxRawScore,
                details: stigma.details
            },
            title: {
                score: titleConverted,
                maxScore: 5,
                ownedCount: title.ownedCount,
                totalCount: 400 // Reference 400
            }
        }
    };
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
