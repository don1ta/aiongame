const fs = require('fs');

async function main() {
    const data = {};

    const slots = {
        MainHand: 'MainHand',
        SubHand: 'SubHand',
        Helmet: 'Helmet',
        Shoulder: 'Shoulder',
        Torso: 'Torso',
        Pants: 'Pants',
        Gloves: 'Gloves',
        Boots: 'Boots',
        Cape: 'Cape',
        Necklace: 'Necklace',
        Earring: 'Earring2',
        Ring: 'Ring2',
        Bracelet: 'Bracelet2',
    };

    const soulbindEndpoints = {};
    for (const [key, slotPos] of Object.entries(slots)) {
        soulbindEndpoints[key + '_PVE'] = `https://aion-api.bnshive.com/stats/equipment?statType=soulbind-attribute&slotPos=${slotPos}&playstyle=PVE`;
        soulbindEndpoints[key + '_PVP'] = `https://aion-api.bnshive.com/stats/equipment?statType=soulbind-attribute&slotPos=${slotPos}&playstyle=PVP`;
    }

    const magicStoneEndpoints = {
        MagicStone_PVE_gear: 'https://aion-api.bnshive.com/stats/equipment?statType=magic-stone-attribute&playstyle=PVE&group=gear',
        MagicStone_PVE_accessory: 'https://aion-api.bnshive.com/stats/equipment?statType=magic-stone-attribute&playstyle=PVE&group=accessory',
        MagicStone_PVP_gear: 'https://aion-api.bnshive.com/stats/equipment?statType=magic-stone-attribute&playstyle=PVP&group=gear',
        MagicStone_PVP_accessory: 'https://aion-api.bnshive.com/stats/equipment?statType=magic-stone-attribute&playstyle=PVP&group=accessory'
    };

    const allEndpoints = { ...soulbindEndpoints, ...magicStoneEndpoints };

    for (const [key, url] of Object.entries(allEndpoints)) {
        try {
            console.log(`Fetching ${key}...`);
            const response = await fetch(url);
            const json = await response.json();

            // Extract top 10
            data[key] = json.distribution
                .sort((a, b) => (b.count || 0) - (a.count || 0))
                .slice(0, 10)
                .map(d => ({
                    statKey: d.statKey || d.name,
                    count: d.count,
                    percent: d.percent,
                    value: d.value // MagicStone needs this
                }));
        } catch (e) {
            console.error(`Failed to fetch ${key}:`, e);
            data[key] = [];
        }
    }

    const jsContent = `window.STATIC_STATS_DATA = ${JSON.stringify(data, null, 2)};`;
    fs.writeFileSync('js/stats_static_data.js', jsContent, 'utf-8');
    console.log('Done!');
}

main();
