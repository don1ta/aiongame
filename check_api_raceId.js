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

async function test_raceId() {
    try {
        console.log("Testing raceId parameter...");

        for (let i = 0; i <= 2; i++) {
            const url = `https://aion-api.bnshive.com/ranking/item-level?page=1&size=1&raceId=${i}`;
            const data = await fetchApi(url);
            if (data.rankings && data.rankings.length > 0) {
                console.log(`raceId=${i}: First item raceName is ${data.rankings[0].raceName}`);
            } else {
                console.log(`raceId=${i}: No rankings found.`);
            }
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

test_raceId();
