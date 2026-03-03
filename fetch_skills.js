
const https = require('https');
const fs = require('fs');
const path = require('path');

const skills = {
    "11710000": "生存姿態", "11720000": "保護盔甲", "11740000": "掌握弱點", "11750000": "攻擊準備", "11760000": "衝擊擊中",
    "12710000": "體力強化", "12720000": "庇護盾牌", "12730000": "斷罪加護", "12740000": "銅牆鐵壁", "12760000": "衝擊擊中", "12770000": "侮辱咆哮", "12790000": "生存意志",
    "13710000": "第六感最大化", "13720000": "瞄準破綻", "13740000": "背後強擊", "13750000": "強襲姿態", "13760000": "衝擊擊中",
    "14710000": "警戒之眼", "14740000": "集中之眼", "14750000": "獵人決心", "14760000": "抵抗決心", "14790000": "回生契約",
    "15720000": "大地長袍", "15740000": "火花長袍", "15770000": "抵抗恩惠", "15780000": "強化恩惠", "15790000": "回生契約",
    "16710000": "精靈打擊", "16720000": "精靈保護", "16740000": "侵蝕", "16760000": "精神集中", "16790000": "回生契約",
    "17710000": "溫暖加護", "17720000": "主神加護", "17730000": "主神恩寵", "17740000": "治癒力強化", "17750000": "不死帳幕", "17790000": "生存意志",
    "18710000": "生命祝福", "18720000": "十字防禦", "18740000": "鼓吹咒語", "18750000": "攻擊準備", "18760000": "衝擊擊中", "18770000": "激怒咒語", "18780000": "大地約定", "18800000": "風之約定"
};

const results = {};

function fetchSkill(id) {
    return new Promise((resolve, reject) => {
        const input = encodeURIComponent(JSON.stringify({ id: id.toString(), language: 'zh' }));
        const targetUrl = `https://questlog.gg/aion-2/api/trpc/database.getSkill?input=${input}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

        https.get(proxyUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        return resolve(null);
                    }
                    const json = JSON.parse(data);
                    if (json.result && json.result.data && json.result.data.json) {
                        resolve(json.result.data.json);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            resolve(null);
        });
    });
}

async function run() {
    const ids = Object.keys(skills);
    for (const id of ids) {
        process.stdout.write(`Fetching ${skills[id]} (${id})... `);
        try {
            const data = await fetchSkill(id);
            if (data) {
                results[id] = data;
                console.log('OK');
            } else {
                console.log('FAIL (No data)');
            }
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    const output = `window.SKILL_DATA_STATIC = ${JSON.stringify(results, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'js', 'skill_data_static.js'), output, 'utf8');
    console.log('\nDone! Saved to js/skill_data_static.js');
}

run();
