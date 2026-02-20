
// 佇列處理器，避免同時發送過多請求
const scoreRequestQueue = [];
let isProcessingQueue = false;

// 處理佇列中的請求 (單線程順序執行，每次間隔 150ms 避免觸發 WAF/RateLimit)
async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (scoreRequestQueue.length > 0) {
        const item = scoreRequestQueue.shift();
        const { serverId, characterId, container } = item;

        try {
            await fetchAndRenderScore(container, serverId, characterId);
        } catch (e) {
            console.error("Queue process error:", e);
        }

        // 間隔 150-300ms 浮動，避免過於規律被擋
        const delay = 150 + Math.random() * 150;
        await new Promise(r => setTimeout(r, delay));
    }

    isProcessingQueue = false;
}

function queueScoreFetch(serverId, characterId, containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="font-size:12px; color:#666;"></i>';
        container.style.display = 'block';
        scoreRequestQueue.push({ serverId, characterId, container });

        // 觸發佇列處理
        processQueue();
    }
}

async function fetchAndRenderScore(container, serverId, characterId) {
    try {
        const queryUrl = `https://aion-api.bnshive.com/character/query?serverId=${serverId}&characterId=${encodeURIComponent(characterId)}`;
        const proxyUrl = getProxyUrl(queryUrl);

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("API Error");

        const json = await res.json();
        const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);

        if (!data) throw new Error("No Data");

        // 獲取遊戲內官方裝分 (ItemLevel)
        let gameScore = 0;
        if (data.stat && data.stat.statList) {
            const stat = data.stat.statList.find(s => s.type === 'ItemLevel');
            if (stat) gameScore = parseInt(stat.value, 10);
        }

        if (gameScore > 0) {
            const scoreText = gameScore.toLocaleString();
            // 仿照遊戲內金色風格，並加上小 ICON
            container.innerHTML = `<span style="color:#ffd93d; font-weight:800; font-size:15px; text-shadow:0 0 10px rgba(255, 217, 61, 0.4);"><i class="fas fa-chart-line" style="font-size:10px; margin-right:3px; color:#aaa;"></i>${scoreText}</span>`;
        } else {
            container.innerHTML = '<span style="color:#666; font-size:10px;">--</span>';
        }

    } catch (e) {
        // console.error(e);
        container.innerHTML = '<span style="color:#444; font-size:10px;">--</span>';
    }
}
