/**
 * Aion2 Server Distribution Stats (server_stats.js)
 * 負責抓取並渲染伺服器排行分布
 * 
 * API: armoryMeta.getServerDistribution
 * Endpoint: https://questlog.gg/aion-2/api/trpc
 */

(function () {
    // 依賴 aion.js 的 getProxyUrl
    const getProxyUrl = window.getProxyUrl || function (url) {
        return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;
    };

    let g_serverRegion = 'tw'; // state

    // 伺服器顏色色系 (Top 3 特殊色，其餘統一)
    // const SERVER_COLOR_PALETTE = [ ... ]; // Removed rainbow palette

    async function fetchServerData() {
        const region = g_serverRegion;
        const baseUrl = "https://questlog.gg/aion-2/api/trpc";
        // 修正: 根據使用者提供的 URL範例，input 直接傳遞物件
        const input = encodeURIComponent(JSON.stringify({ region: region }));

        try {
            console.log(`[ServerStats] Fetching data for region: ${region}`);
            const res = await fetch(getProxyUrl(`${baseUrl}/armoryMeta.getServerDistribution?input=${input}`));
            const json = await res.json();
            return json?.result?.data?.json || json?.result?.data;
        } catch (e) {
            console.error("[ServerStats] Failed to fetch server data", e);
            return null;
        }
    }

    // 更新 UI 切換按鈕樣式
    function updateServerRegionUI() {
        const btnTw = document.getElementById('server-stats-region-btn-tw');
        const btnKo = document.getElementById('server-stats-region-btn-ko');

        if (btnTw && btnKo) {
            const activeStyle = "background:#3b82f6; color:white; border:none; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;";
            const inactiveStyle = "background:transparent; color:#8b949e; border:none; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;";

            if (g_serverRegion === 'tw') {
                btnTw.style.cssText = activeStyle;
                btnKo.style.cssText = inactiveStyle;
            } else {
                btnTw.style.cssText = inactiveStyle;
                btnKo.style.cssText = activeStyle;
            }
        }
    }

    function renderServerChart(serverData, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let segments = [];

        // 處理數據結構
        if (Array.isArray(serverData)) {
            segments = serverData.map(d => ({
                id: d.serverName || d.server || d.serverId || `Server ${d.id}`,
                val: d.count || d.value || 0
            }));
        } else if (typeof serverData === 'object' && serverData !== null) {
            segments = Object.keys(serverData).map(k => ({
                id: k,
                val: serverData[k]
            }));
        }

        if (segments.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">無伺服器數據</div>';
            return;
        }

        // 排序
        segments.sort((a, b) => b.val - a.val);

        if (segments.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">無數據</div>';
            return;
        }

        // 計算最大值作為 100% 基準
        const maxVal = segments[0].val;

        let html = '';

        // Generate Grid Items (全顯示)
        segments.forEach((seg, index) => {
            // 色彩邏輯: 前三名金銀銅，其餘統一藍色，減少視覺疲勞
            let color = '#4aa8ff'; // 預設柔和藍
            let rankColor = '#ccc'; // 排名數字顏色

            if (index === 0) { color = '#ffd700'; rankColor = '#ffd700'; } // 金
            else if (index === 1) { color = '#c0c0c0'; rankColor = '#c0c0c0'; } // 銀
            else if (index === 2) { color = '#cd7f32'; rankColor = '#cd7f32'; } // 銅
            else {
                color = '#3b82f6'; // 統一藍色，不刺眼
                rankColor = '#64748b'; // 排名顏色淡化
            }

            // 計算長度比例 (相對於第一名)
            const widthPerc = ((seg.val / maxVal) * 100).toFixed(1);

            // Format number
            const valStr = seg.val.toLocaleString();

            html += `
            <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.04); border-radius:6px; padding:8px 12px; display:flex; flex-direction:column; justify-content:center;">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px; color:#e6edf3; font-size:13px; align-items:center;">
                    <div style="font-weight:bold; display:flex; align-items:center; overflow:hidden;">
                        <span style="color:${rankColor}; margin-right:8px; font-size:14px; min-width:24px;">#${index + 1}</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#cbd5e1;" title="${seg.id}">${seg.id}</span>
                    </div>
                    <span style="font-family:monospace; color:#94a3b8; font-weight:bold; font-size:12px;">${valStr}</span>
                </div>
                <div style="width:100%; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;">
                    <div style="width:${widthPerc}%; height:100%; background:${color}; border-radius:2px; opacity:0.8;"></div>
                </div>
            </div>
            `;
        });

        // Wrap in grid container (2 columns)
        container.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
                ${html}
            </div>
        `;
        container.style.marginTop = '15px';
    }

    // 當切換區域時呼叫
    window.switchServerRegion = function (region) {
        if (g_serverRegion === region) return;
        g_serverRegion = region;

        updateServerRegionUI();
        window.renderServerDistributionTab();
    };

    // 主要渲染入口
    window.renderServerDistributionTab = async function () {
        const container = document.getElementById('server-dist-chart-container');
        if (!container) return;

        updateServerRegionUI(); // 初始化 UI 狀態

        // 先顯示載入中
        container.innerHTML = '<div style="text-align:center;color:#888;padding:50px;">載入伺服器數據中...</div>';

        const data = await fetchServerData();

        if (!data) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:50px;">無法獲取伺服器數據 (API Error)</div>';
            return;
        }

        // Render Race Distribution Data (from module: class_distribution.js)
        if (window.renderRaceDistributionPart) {
            // Pass region to ensure correct data
            window.renderRaceDistributionPart(g_serverRegion);
        }

        renderServerChart(data, 'server-dist-chart-container');
    };

})();
