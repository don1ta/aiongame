// 修改 aion.html 的腳本
// 1. 添加 tooltip 關閉按鈕功能
// 2. 修正裝備屬性計算,將基本值和強化值分開顯示

const fs = require('fs');
const path = require('path');

const filePath = 'd:\\c150075\\Desktop\\testtttt\\aion.html';
let content = fs.readFileSync(filePath, 'utf8');

// 1. 在 renderStatTable 函數中添加關閉按鈕
const renderStatTablePattern = /const cell = \(val\) => val === 0 \? '<td>--<\/td>' : `<td><div class="hover-calc">\$\{fmt\(val\)\}<div class="tooltip">\$\{tooltip\}<\/div><\/div><\/td>`;/;
const renderStatTableReplacement = `const cell = (val) => val === 0 ? '<td>--</td>' : \`<td><div class="hover-calc">\${fmt(val)}<div class="tooltip"><button class="tooltip-close-btn" onclick="this.parentElement.classList.remove('tooltip-pinned')">✕</button>\${tooltip}</div></div></td>\`;`;

if (content.match(renderStatTablePattern)) {
    content = content.replace(renderStatTablePattern, renderStatTableReplacement);
    console.log('✓ 已添加 tooltip 關閉按鈕');
} else {
    console.log('⚠ 找不到 renderStatTable 的 cell 函數');
}

// 2. 修改裝備主屬性計算邏輯
// 搜索: (d.mainStats || []).forEach(ms => { let v = parseFloat(ms.value || 0) + parseFloat(ms.extra || 0); let e = getEntry(ms.name); e.equipMain += v; e.detailGroups.base.push(`+${i.enchantLevel} ${d.name}: +${v}`); });
const mainStatsPattern = /\(d\.mainStats \|\| \[\]\)\.forEach\(ms => \{ let v = parseFloat\(ms\.value \|\| 0\) \+ parseFloat\(ms\.extra \|\| 0\); let e = getEntry\(ms\.name\); e\.equipMain \+= v; e\.detailGroups\.base\.push\(`\+\$\{i\.enchantLevel\} \$\{d\.name\}: \+\$\{v\}`\); \}\);/;

const mainStatsReplacement = `(d.mainStats || []).forEach(ms => { 
                        let baseVal = parseFloat(ms.value || 0);
                        let extraVal = parseFloat(ms.extra || 0);
                        let totalVal = baseVal + extraVal;
                        let e = getEntry(ms.name); 
                        e.equipMain += totalVal; 
                        // 分開顯示基本值和強化值
                        if (extraVal > 0) {
                            e.detailGroups.base.push(\`+\${i.enchantLevel} \${d.name}: +\${baseVal} <span style="color:var(--green);">(強化 +\${extraVal})</span>\`);
                        } else {
                            e.detailGroups.base.push(\`+\${i.enchantLevel} \${d.name}: +\${totalVal}\`);
                        }
                    });`;

if (content.match(mainStatsPattern)) {
    content = content.replace(mainStatsPattern, mainStatsReplacement);
    console.log('✓ 已修正裝備屬性計算邏輯');
} else {
    console.log('⚠ 找不到 mainStats 處理邏輯');
}

// 3. 添加點擊事件處理器來固定 tooltip
const scriptEndPattern = /<\/script>/;
const tooltipScript = `
        // Tooltip 點擊固定功能
        document.addEventListener('DOMContentLoaded', function() {
            // 為所有 hover-calc 元素添加點擊事件
            document.addEventListener('click', function(e) {
                const hoverCalc = e.target.closest('.hover-calc');
                if (hoverCalc) {
                    const tooltip = hoverCalc.querySelector('.tooltip');
                    if (tooltip) {
                        // 如果點擊的不是關閉按鈕,則切換固定狀態
                        if (!e.target.classList.contains('tooltip-close-btn')) {
                            // 先關閉所有其他固定的 tooltip
                            document.querySelectorAll('.tooltip.tooltip-pinned').forEach(t => {
                                if (t !== tooltip) {
                                    t.classList.remove('tooltip-pinned');
                                }
                            });
                            // 切換當前 tooltip 的固定狀態
                            tooltip.classList.toggle('tooltip-pinned');
                            e.stopPropagation();
                        }
                    }
                }
            });
        });
    </script>`;

content = content.replace(scriptEndPattern, tooltipScript);
console.log('✓ 已添加 tooltip 點擊固定功能');

// 寫回檔案
fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ 檔案已成功更新!');
