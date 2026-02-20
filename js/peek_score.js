
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

            // 決定分數專屬顏色
            let scoreColor = '#f8f9fa'; // 預設白
            if (gameScore >= 4000) scoreColor = '#ff4d4d'; // 神話紅
            else if (gameScore >= 3000) scoreColor = '#f1c40f'; // 英雄金
            else if (gameScore >= 2500) scoreColor = '#00d4ff'; // 稀有藍
            else if (gameScore >= 2000) scoreColor = '#2ecc71'; // 傳承綠

            // 仿照遊戲內金色風格，純數字更具衝擊力，放大與整體名片匹配
            container.innerHTML = `<span style="color:${scoreColor}; font-weight:900; font-size:26px; letter-spacing:0.5px; text-shadow:0 3px 6px rgba(0,0,0,0.8);">${scoreText}</span>`;

            // 動態更新外框顏色與名字顏色
            const cardEl = document.getElementById(`search-card-${characterId}`);
            if (cardEl) {
                cardEl.style.setProperty('--card-score-color', scoreColor);
            }
        } else {
            container.innerHTML = '<span style="color:#666; font-size:10px;">--</span>';
        }

    } catch (e) {
        // console.error(e);
        container.innerHTML = '<span style="color:#444; font-size:10px;">--</span>';
    }
}
