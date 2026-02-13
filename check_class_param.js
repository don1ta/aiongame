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

async function testClassParam() {
    try {
        console.log("Testing className parameter...");

        // Case 1: English 'Gladiator'
        const urlEng = 'https://aion-api.bnshive.com/ranking/item-level?page=1&size=1&className=Gladiator';
        const dataEng = await fetchApi(urlEng);
        if (dataEng.rankings && dataEng.rankings.length > 0) {
            console.log(`className=Gladiator returns: ${dataEng.rankings[0].className} - ${dataEng.rankings[0].characterName}`);
        } else {
            console.log(`className=Gladiator returns no rankings`);
        }

        // Case 2: Chinese '劍星'
        const urlChi = 'https://aion-api.bnshive.com/ranking/item-level?page=1&size=1&className=' + encodeURIComponent('劍星');
        const dataChi = await fetchApi(urlChi);
        if (dataChi.rankings && dataChi.rankings.length > 0) {
            console.log(`className=劍星 returns: ${dataChi.rankings[0].className} - ${dataChi.rankings[0].characterName}`);
        } else {
            console.log(`className=劍星 returns no rankings (or empty list)`);
        }

        // Case 3: Empty or Invalid
        const urlInv = 'https://aion-api.bnshive.com/ranking/item-level?page=1&size=1&className=InvalidClass';
        const dataInv = await fetchApi(urlInv);
        if (dataInv.rankings && dataInv.rankings.length > 0) {
            console.log(`className=InvalidClass returns: ${dataInv.rankings[0].className} - ${dataInv.rankings[0].characterName}`);
        } else {
            console.log(`className=InvalidClass returns no rankings`);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

testClassParam();
