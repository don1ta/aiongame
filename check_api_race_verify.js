const https = require('https');

function fetchApi(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
}

async function test_race_elyos() {
    try {
        console.log("Testing race parameter...");

        const raceTestElyos = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=5&race=ELYOS');
        console.log("Query race=ELYOS count:", raceTestElyos.rankings ? raceTestElyos.rankings.length : 0);
        if (raceTestElyos.rankings && raceTestElyos.rankings.length > 0) console.log("First item race:", raceTestElyos.rankings[0].raceName);

        const raceTestAsmodians = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=5&race=ASMODIANS');
        console.log("Query race=ASMODIANS count:", raceTestAsmodians.rankings ? raceTestAsmodians.rankings.length : 0);
        if (raceTestAsmodians.rankings && raceTestAsmodians.rankings.length > 0) console.log("First item race:", raceTestAsmodians.rankings[0].raceName);

    } catch (e) {
        console.error("Error:", e);
    }
}

test_race_elyos();
