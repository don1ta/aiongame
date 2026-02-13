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

async function testfilters() {
    try {
        console.log("Checking filters...");
        const data = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=1');
        if (data.filters) {
            console.log("Filters:", JSON.stringify(data.filters, null, 2));
        } else {
            console.log("No filters found in response.");
        }

        console.log("\nTesting race parameter...");
        // Test raceId=1 (Asmodian usually, or Elyos?)
        // Let's try to infer from results.
        const raceTest1 = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=5&race=ASMODIANS');
        console.log("Query race=ASMODIANS (Guess) count:", raceTest1.rankings ? raceTest1.rankings.length : 0);
        if (raceTest1.rankings && raceTest1.rankings.length > 0) console.log("First item race:", raceTest1.rankings[0].raceName);

        const raceTest2 = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=5&raceId=1');
        console.log("Query raceId=1 (Guess) count:", raceTest2.rankings ? raceTest2.rankings.length : 0);
        if (raceTest2.rankings && raceTest2.rankings.length > 0) console.log("First item race:", raceTest2.rankings[0].raceName);

        const raceTest3 = await fetchApi('https://aion-api.bnshive.com/ranking/item-level?page=1&size=5&raceName=魔族');
        console.log("Query raceName=魔族 (Guess) count:", raceTest3.rankings ? raceTest3.rankings.length : 0);

    } catch (e) {
        console.error("Error:", e);
    }
}

testfilters();
