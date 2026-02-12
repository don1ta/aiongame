// 裝備來源評分系統
// 根據全服使用率數據給予裝備評分

// 全服裝備來源使用率數據 (根據 https://aion2.bnshive.com/stats/equipment/category)
const EQUIPMENT_SOURCE_RARITY = {
    // 傳說級 (< 1%)
    '副本:蘊德薩手環': { rate: 0.95, tier: 'SSS', score: 100 },
    '副本:魔德薩手環': { rate: 0.54, tier: 'SSS', score: 100 },
    '副本:蘊德薩系[96]': { rate: 0.05, tier: 'SSS', score: 100 },

    // 史詩級 (1% - 5%)
    '嗜龍王/嗜龍主': { rate: 7.27, tier: 'SS', score: 80 },
    '白龍王/黑龍主': { rate: 5.00, tier: 'SS', score: 80 },
    '深淵手環': { rate: 3.31, tier: 'SS', score: 80 },
    '郵聖者手環': { rate: 2.40, tier: 'SS', score: 80 },
    '副本:被優越的深影[96]': { rate: 1.01, tier: 'SS', score: 80 },

    // 稀有級 (5% - 10%)
    '副本:古代遺跡[96]': { rate: 8.82, tier: 'S', score: 60 },
    '副本:骨人/骨人[76]': { rate: 8.89, tier: 'S', score: 60 },
    '變醒手環': { rate: 6.22, tier: 'S', score: 60 },
    '副本:克爾/水龍[68]': { rate: 5.18, tier: 'S', score: 60 },

    // 優秀級 (10% - 20%)
    '真龍王/乾龍主': { rate: 12.75, tier: 'A', score: 40 },
    '副本:專龍[92]': { rate: 7.09, tier: 'A', score: 40 },

    // 良好級 (20% - 30%)
    // 目前數據中沒有此範圍

    // 普通級 (> 30%)
    '副本:火焰/冰雪[84]': { rate: 30.51, tier: 'C', score: 10 },
};

// 根據來源名稱獲取稀有度信息
function getSourceRarity(sourceName) {
    // 精確匹配
    if (EQUIPMENT_SOURCE_RARITY[sourceName]) {
        return EQUIPMENT_SOURCE_RARITY[sourceName];
    }

    // 模糊匹配 (移除空格、符號等)
    const normalized = sourceName.replace(/\s+/g, '').toLowerCase();
    for (let key in EQUIPMENT_SOURCE_RARITY) {
        const normalizedKey = key.replace(/\s+/g, '').toLowerCase();
        if (normalized.includes(normalizedKey) || normalizedKey.includes(normalized)) {
            return EQUIPMENT_SOURCE_RARITY[key];
        }
    }

    // 默認為普通級
    return { rate: 100, tier: 'C', score: 10 };
}

// 計算裝備來源評分
function calculateEquipmentScore(itemDetails) {
    if (!itemDetails || !Array.isArray(itemDetails)) {
        return {
            totalScore: 0,
            maxScore: 1000,
            percentage: 0,
            grade: 'F',
            details: [],
            setBonus: 0,
            breakdown: {
                baseScore: 0,
                setBonusScore: 0
            }
        };
    }

    let baseScore = 0;
    let details = [];
    let sourceCount = {};

    // 計算每件裝備的分數
    itemDetails.forEach(item => {
        const d = item.detail;
        if (!d || !d.sources || d.sources.length === 0) return;

        const slot = item.slotPos;
        const isArmor = (slot >= 1 && slot <= 8) || slot === 21;
        const isAccessory = (slot >= 9 && slot <= 20) || (slot >= 22 && slot <= 40);

        // 只計算武防和飾品
        if (!isArmor && !isAccessory) return;

        // 取第一個來源作為主要來源
        const mainSource = d.sources[0];
        const rarity = getSourceRarity(mainSource);

        baseScore += rarity.score;

        // 統計來源數量（用於套裝加成）
        if (!sourceCount[mainSource]) {
            sourceCount[mainSource] = { count: 0, rarity: rarity };
        }
        sourceCount[mainSource].count++;

        details.push({
            name: d.name,
            source: mainSource,
            rarity: rarity,
            score: rarity.score,
            slot: slot,
            isArmor: isArmor
        });
    });

    // 計算套裝加成
    let setBonusMultiplier = 1.0;
    let setBonusScore = 0;
    let maxSetCount = 0;
    let maxSetSource = '';

    for (let source in sourceCount) {
        const count = sourceCount[source].count;
        if (count > maxSetCount) {
            maxSetCount = count;
            maxSetSource = source;
        }
    }

    // 套裝加成規則
    if (maxSetCount >= 6) {
        setBonusMultiplier = 2.0; // +100%
    } else if (maxSetCount >= 4) {
        setBonusMultiplier = 1.25; // +25%
    } else if (maxSetCount >= 2) {
        setBonusMultiplier = 1.10; // +10%
    }

    setBonusScore = baseScore * (setBonusMultiplier - 1);
    const totalScore = Math.round(baseScore * setBonusMultiplier);
    const percentage = Math.round((totalScore / 1000) * 100);

    // 評級
    let grade = 'F';
    if (percentage >= 90) grade = 'SSS';
    else if (percentage >= 80) grade = 'SS';
    else if (percentage >= 70) grade = 'S';
    else if (percentage >= 60) grade = 'A';
    else if (percentage >= 50) grade = 'B';
    else if (percentage >= 40) grade = 'C';
    else if (percentage >= 30) grade = 'D';
    else if (percentage >= 20) grade = 'E';

    return {
        totalScore: totalScore,
        maxScore: 1000,
        percentage: percentage,
        grade: grade,
        details: details,
        setBonus: Math.round(setBonusScore),
        setBonusMultiplier: setBonusMultiplier,
        maxSetCount: maxSetCount,
        maxSetSource: maxSetSource,
        breakdown: {
            baseScore: Math.round(baseScore),
            setBonusScore: Math.round(setBonusScore)
        }
    };
}

// 獲取評級顏色
function getGradeColor(grade) {
    const colors = {
        'SSS': '#ff0000',  // 紅色
        'SS': '#ff6b35',   // 橙紅色
        'S': '#ffa500',    // 橙色
        'A': '#ffd700',    // 金色
        'B': '#00d4ff',    // 藍色
        'C': '#00ff88',    // 綠色
        'D': '#888888',    // 灰色
        'E': '#666666',    // 深灰色
        'F': '#444444'     // 更深灰色
    };
    return colors[grade] || '#888888';
}

// 獲取稀有度顏色
function getTierColor(tier) {
    const colors = {
        'SSS': '#ff0000',  // 紅色 - 傳說
        'SS': '#9b59b6',   // 紫色 - 史詩
        'S': '#3498db',    // 藍色 - 稀有
        'A': '#2ecc71',    // 綠色 - 優秀
        'B': '#f39c12',    // 橙色 - 良好
        'C': '#95a5a6'     // 灰色 - 普通
    };
    return colors[tier] || '#95a5a6';
}
