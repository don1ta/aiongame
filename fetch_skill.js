const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function main() {
    const skills = [
        { id: '14710000', level: 16, name: '警戒之眼' },
        { id: '14740000', level: 24, name: '集中之眼' },
    ];

    for (const s of skills) {
        const input = encodeURIComponent(JSON.stringify({ id: s.id, language: 'zh' }));
        const url = `https://questlog.gg/aion-2/api/trpc/database.getSkill?input=${input}`;
        const raw = await fetchUrl(url);
        const json = JSON.parse(raw);
        const skill = json.result?.data;

        console.log(`\n=== ${skill.name} (Lv${s.level}) ===`);
        console.log('descriptionData.text:', skill.descriptionData?.text);
        console.log('');

        const dd = skill.descriptionData;
        if (dd) {
            for (const [key, varData] of Object.entries(dd)) {
                if (key === 'text' || key === 'variables') continue;
                const modifier = varData.modifier;
                const property = varData.property;
                const lvData = varData.levels?.[s.level];
                if (lvData) {
                    console.log(`  KEY: ${key}`);
                    console.log(`    modifier=${modifier}  property=${property}  Lv${s.level} values=[${lvData.values?.join(', ')}]`);
                }
            }
        }
    }
}

main().catch(console.error);
