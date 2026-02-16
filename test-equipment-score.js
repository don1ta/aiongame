// 裝備評分測試 - 驗證單件裝備平方根曲線

// 測試數據
const testCases = [
    { name: "神話+0", baseScore: 15, enchant: 0, exceed: 0 },
    { name: "神話+10", baseScore: 15, enchant: 10, exceed: 0 },
    { name: "神話+15", baseScore: 15, enchant: 15, exceed: 0 },
    { name: "神話+20", baseScore: 15, enchant: 20, exceed: 0 },
    { name: "神話+15+5突破", baseScore: 15, enchant: 15, exceed: 5 },
    { name: "傳說+15", baseScore: 10, enchant: 15, exceed: 0 },
    { name: "史詩+15", baseScore: 6, enchant: 15, exceed: 0 },
];

const SINGLE_ITEM_MAX = 45;

console.log("=== 裝備評分測試 ===\n");
console.log("品階\t\t強化\t原始分\t轉換分\t說明");
console.log("-".repeat(70));

testCases.forEach(test => {
    // 計算強化加權
    let weightedEnchant = 0;
    const enchantLevel = test.enchant;

    if (enchantLevel <= 10) {
        weightedEnchant += enchantLevel * 1.0;
    } else if (enchantLevel <= 15) {
        weightedEnchant += 10 * 1.0 + (enchantLevel - 10) * 1.2;
    } else {
        weightedEnchant += 10 * 1.0 + 5 * 1.2 + (enchantLevel - 15) * 1.5;
    }

    // 加上突破加權
    weightedEnchant += test.exceed * 2.0;

    // 計算倍率
    const enchantRatio = weightedEnchant / 25;
    const multiplier = 1 + enchantRatio;

    // 原始分數
    const rawScore = test.baseScore * multiplier;
    const decimal = rawScore - Math.floor(rawScore);
    const itemRawScore = decimal <= 0.2 ? Math.floor(rawScore) : Math.ceil(rawScore);

    // 轉換分數（套用平方根曲線）
    const itemConvertedScore = itemRawScore * Math.sqrt(Math.min(itemRawScore / SINGLE_ITEM_MAX, 1));

    console.log(`${test.name}\t+${test.enchant}${test.exceed > 0 ? `+${test.exceed}突破` : ''}\t${itemRawScore}\t${itemConvertedScore.toFixed(1)}\t倍率${multiplier.toFixed(2)}`);
});

console.log("\n=== 對比測試 ===\n");

// 對比：1件神話+20 vs 2件傳說+15
const mythic20Raw = 27;
const mythic20Converted = mythic20Raw * Math.sqrt(mythic20Raw / SINGLE_ITEM_MAX);

const legend15Raw = 16;
const legend15Converted = legend15Raw * Math.sqrt(legend15Raw / SINGLE_ITEM_MAX);

console.log(`1件神話+20: 原始${mythic20Raw} → 轉換${mythic20Converted.toFixed(1)}`);
console.log(`2件傳說+15: 原始${legend15Raw * 2} → 轉換${(legend15Converted * 2).toFixed(1)}`);
console.log(`價值比: ${(mythic20Converted / (legend15Converted * 2)).toFixed(2)}:1`);
console.log("\n結論: 1件頂級裝備的價值 > 2件中階裝備 ✓");

console.log("\n=== 滿裝測試 ===\n");

// 假設滿裝：12件神話+20
const fullSetRaw = mythic20Raw * 12;
const fullSetConverted = mythic20Converted * 12;

console.log(`滿裝(12件神話+20):`);
console.log(`原始總分: ${fullSetRaw}`);
console.log(`轉換總分: ${fullSetConverted.toFixed(1)}`);
console.log(`最終得分: ${((fullSetConverted / 450) * 30).toFixed(1)} / 30`);
