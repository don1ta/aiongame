// 在 questlog.gg 技能頁面的 Console 中運行此腳本
// 用於批量抓取技能數據

(function () {
    // 職業名稱對照表 (questlog 標題通常含英文職業名)
    const classMap = {
        'Gladiator': '劍星',
        'Templar': '守護星',
        'Ranger': '弓星',
        'Assassin': '殺星',
        'Sorcerer': '魔道星',
        'Spiritmaster': '精靈星',
        'Cleric': '治癒星',
        'Chanter': '護法星'
    };

    // 自動偵測職業
    let targetCategory = "通用";
    const pageTitle = document.title;
    for (const [eng, chi] of Object.entries(classMap)) {
        if (pageTitle.includes(eng) || pageTitle.includes(chi)) {
            targetCategory = chi;
            break;
        }
    }

    console.log(`🔍 開始抓取 [${targetCategory}] 技能數據...`);

    const skills = {};

    // 查找所有技能卡片
    const skillCards = document.querySelectorAll('[class*="skill"], [class*="card"]');

    console.log(`找到 ${skillCards.length} 個元素`);

    // 嘗試不同的選擇器
    const possibleSelectors = [
        'a[href*="/skill/"]',
        '[data-skill-id]',
        '.skill-item',
        '.skill-card'
    ];

    let skillLinks = [];
    for (let selector of possibleSelectors) {
        const links = document.querySelectorAll(selector);
        if (links.length > 0) {
            console.log(`✓ 使用選擇器: ${selector}, 找到 ${links.length} 個技能`);
            skillLinks = links;
            break;
        }
    }

    if (skillLinks.length === 0) {
        console.warn('❌ 未找到技能連結,請手動檢查頁面結構');
        console.log('💡 請在 Console 中執行: document.body.innerHTML');
        console.log('然後搜尋技能相關的 HTML 結構');
        return;
    }

    // 提取技能資訊
    skillLinks.forEach((link, index) => {
        const href = link.getAttribute('href');
        if (href && href.includes('/skill/')) {
            const skillId = href.match(/\/skill\/(\d+)/)?.[1];
            const skillName = link.textContent.trim() || link.querySelector('[class*="name"]')?.textContent.trim();

            if (skillId && skillName) {
                skills[skillId] = {
                    name: skillName,
                    url: `https://questlog.gg${href}`
                };
                console.log(`${index + 1}. ${skillName} (ID: ${skillId})`);
            }
        }
    });

    console.log(`\n📋 找到 ${Object.keys(skills).length} 個 [${targetCategory}] 技能:`);
    // console.log(JSON.stringify(skills, null, 2));

    console.log('\n💾 複製以下代碼到技能資料庫:');

    // 生成技能資料庫格式
    let output = '';
    for (let skillId in skills) {
        output += `    "${skillId}": {\n`;
        output += `        name: "${skills[skillId].name}",\n`;
        output += `        category: "${targetCategory}",\n`;
        output += `        levels: {\n`;
        // output += `            // TODO: 訪問 ${skills[skillId].url} 填入各等級效果\n`;
        output += `            1: ["效果1", "效果2", "效果3"],\n`;
        output += `        }\n`;
        output += `    },\n\n`;
    }

    console.log(output);

    // 複製到剪貼簿
    if (navigator.clipboard) {
        navigator.clipboard.writeText(output).then(() => {
            console.log('✅ 已複製到剪貼簿!');
        });
    }

    return skills;
})();
