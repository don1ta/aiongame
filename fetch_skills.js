/**
 * fetch_skills.js
 * 
 * 執行方式：node fetch_skills.js
 * 
 * 功能：直接連線 QuestLog API 抓取全量技能資料，
 *      生成靜態資料檔案 js/skill_data_static.js。
 * 
 * 📌 以後遊戲新增技能需要更新時，只要執行：
 *    node fetch_skills.js
 *    然後 commit js/skill_data_static.js 即可。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── 讀取 skill-names.js 取得全量技能 ID 清單 ──
const skillNamesContent = fs.readFileSync(path.join(__dirname, 'js', 'skill-names.js'), 'utf8');
const skillIdMatch = skillNamesContent.match(/"(\d{8})":\s*"([^"]+)"/g);
const skillsToFetch = {};

if (skillIdMatch) {
    skillIdMatch.forEach(m => {
        const parts = m.match(/"(\d{8})":\s*"([^"]+)"/);
        if (parts) skillsToFetch[parts[1]] = parts[2];
    });
}

const results = {};

// ── 直接打 QuestLog API（Node.js 不受 CORS 限制）──
function fetchSkill(id) {
    return new Promise((resolve) => {
        const input = encodeURIComponent(JSON.stringify({ id: id.toString(), language: 'zh' }));
        const url = `https://questlog.gg/aion-2/api/trpc/database.getSkill?input=${input}`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const rawData = json.result?.data?.json || json.result?.data || json.data;
                    resolve(rawData || null);
                } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null))
            .on('timeout', function () { this.destroy(); resolve(null); });
    });
}

async function run() {
    const ids = Object.keys(skillsToFetch);
    console.log(`🚀 開始抓取全量技能 (共 ${ids.length} 個)...\n`);

    let ok = 0, fail = 0;

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        process.stdout.write(`[${i + 1}/${ids.length}] ${skillsToFetch[id]} (${id})... `);

        let data = null;
        // 失敗時最多重試 2 次
        for (let retry = 0; retry < 3; retry++) {
            data = await fetchSkill(id);
            if (data) break;
            if (retry < 2) await new Promise(r => setTimeout(r, 500));
        }

        if (data) {
            results[id] = {
                name: data.name,
                icon: data.icon,
                descriptionData: data.descriptionData,
                levels: data.levels
            };
            console.log('✅');
            ok++;
        } else {
            console.log('❌ 無資料（可能此技能不在 QuestLog 資料庫中）');
            fail++;
        }

        await new Promise(r => setTimeout(r, 120)); // 避免頻率過高
    }

    console.log(`\n🎉 完成！成功: ${ok} 個，失敗: ${fail} 個`);
    const output = `window.SKILL_DATA_STATIC = ${JSON.stringify(results, null, 2)};\n`;
    fs.writeFileSync(path.join(__dirname, 'js', 'skill_data_static.js'), output, 'utf8');
    console.log('✅ 已儲存至 js/skill_data_static.js');
    console.log('📌 請 commit 這個檔案後 push 到 GitHub Pages 即可生效。');
}

run();
