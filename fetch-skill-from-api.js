// 在瀏覽器 Console 中運行此腳本
// 用於從 questlog.gg API 批量獲取技能數據並轉換為資料庫格式

async function fetchSkillData(skillId) {
    const url = `https://questlog.gg/aion-2/api/trpc/database.getSkill?input=${encodeURIComponent(JSON.stringify({ id: skillId, language: "zh" }))}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`獲取技能 ${skillId} 失敗:`, error);
        return null;
    }
}

function parseSkillEffects(skillData) {
    // 解析技能數據並提取效果
    // 這個函數需要根據實際 API 返回的數據結構調整

    if (!skillData || !skillData.result) {
        return null;
    }

    const skill = skillData.result.data;
    const skillInfo = {
        id: skill.id,
        name: skill.name,
        category: "治癒星", // 根據需要修改
        levels: {}
    };

    // 假設 API 返回包含各等級效果的數據
    // 需要根據實際結構調整
    if (skill.levels) {
        for (let level in skill.levels) {
            const effects = [];
            const levelData = skill.levels[level];

            // 提取效果描述
            if (levelData.effects) {
                levelData.effects.forEach(effect => {
                    effects.push(effect.description || effect.desc);
                });
            }

            skillInfo.levels[level] = effects;
        }
    }

    return skillInfo;
}

function generateSkillDatabaseCode(skillInfo) {
    let code = `    "${skillInfo.id}": {\n`;
    code += `        name: "${skillInfo.name}",\n`;
    code += `        category: "${skillInfo.category}",\n`;
    code += `        levels: {\n`;

    for (let level in skillInfo.levels) {
        const effects = skillInfo.levels[level];
        const effectsStr = effects.map(e => `"${e}"`).join(', ');
        code += `            ${level}: [${effectsStr}],\n`;
    }

    code += `        }\n`;
    code += `    },\n`;

    return code;
}

// 主函數:批量處理技能
async function batchFetchSkills(skillIds) {
    console.log(`🔍 開始獲取 ${skillIds.length} 個技能...`);

    let allCode = '';

    for (let i = 0; i < skillIds.length; i++) {
        const skillId = skillIds[i];
        console.log(`\n[${i + 1}/${skillIds.length}] 獲取技能 ${skillId}...`);

        const data = await fetchSkillData(skillId);

        if (data) {
            console.log('✓ 獲取成功');
            console.log('原始數據:', data);

            // 您需要根據實際數據結構調整解析邏輯
            // 這裡只是示例

            // 暫時先顯示原始數據,讓您查看結構
            console.log('\n請查看上方的原始數據,並手動提取效果');
        } else {
            console.log('✗ 獲取失敗');
        }

        // 避免請求過快
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return allCode;
}

// 使用範例:
// 1. 單個技能
console.log('=== 單個技能獲取範例 ===');
console.log('執行: fetchSkillData("17710000").then(data => console.log(data))');

// 2. 批量獲取
console.log('\n=== 批量獲取範例 ===');
console.log('執行: batchFetchSkills(["17710000", "17750000"]).then(code => console.log(code))');

// 治癒星常見被動技能 ID 列表 (您需要補充)
const clericPassiveSkills = [
    "17710000", // 請在這裡添加技能 ID
    "17750000", // 不死帳幕
    // 添加更多...
];

console.log('\n💡 提示: 執行以下命令開始批量獲取:');
console.log('batchFetchSkills(clericPassiveSkills)');
