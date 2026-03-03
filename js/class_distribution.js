/**
 * Aion2 Class & Race Distribution (class_distribution.js)
 * 負責抓取並渲染職業分布與種族分布圖表
 * 
 * API Source: QuestLog.gg (via Proxy)
 * Endpoints: 
 * - armoryMeta.getClassDistribution
 * - armoryMeta.getRaceDistribution
 * - armoryMeta.getClassPerformanceMatrix
 */

(function () {
    // 依賴 aion.js 的 getProxyUrl
    const getProxyUrl = window.getProxyUrl || function (url) {
        return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;
    };

    // State
    let g_currentRegion = 'tw';

    // API 結果快取 (避免重複請求)
    const _dataCache = {};       // { region: { data, timestamp } }
    const _inflight = {};        // { region: Promise } 防止同時發送重複請求
    const CACHE_TTL = 5 * 60 * 1000; // 5 分鐘快取

    // 職業顏色定義
    // 職業顏色定義 (參考用戶截圖風格 - Vibrant Flat Colors)
    const CLASS_COLORS = {
        'gladiator': '#e67e22', // 橘色 (劍星) - Match screenshot
        'templar': '#27ae60',   // 綠色 (守護) - Match screenshot
        'assassin': '#1abc9c',  // 青色 (殺星) - Match screenshot
        'ranger': '#9b59b6',    // 紫色 (弓星) - Match screenshot
        'sorcerer': '#e74c3c',  // 紅色 (魔道) - Match screenshot
        'spirit_master': '#3498db', // 藍色 (精靈) - Match screenshot
        'spiritmaster': '#3498db',
        'elementrist': '#3498db',
        'elementalist': '#3498db',
        'cleric': '#f1c40f',    // 黃色 (治癒) - Match screenshot
        'chanter': '#f39c12',   // 深黃/淺橘 (護法) - Match screenshot
        'gunner': '#ffcccc',
        'painter': '#ff9ff3',
        'bard': '#22a6b3',
        'rider': '#30336b',
        'thunderer': '#be2edd'
    };

    // 中文名稱對照
    const CLASS_NAMES = {
        'gladiator': '劍星', 'templar': '守護星', 'assassin': '殺星', 'ranger': '弓星',
        'sorcerer': '魔道星', 'spirit_master': '精靈星', 'spiritmaster': '精靈星', 'elementallist': '精靈星', 'elementalist': '精靈星',
        'cleric': '治癒星', 'chanter': '護法星',
        'painter': '彩繪星', 'gunner': '槍擊星', 'bard': '吟遊星', 'rider': '機甲星', 'thunderer': '雷擊星'
    };

    // 中文簡稱 (用於堆疊條形圖)
    const CLASS_SHORT_NAMES = {
        'gladiator': '劍', 'templar': '守', 'assassin': '殺', 'ranger': '弓',
        'sorcerer': '魔', 'spirit_master': '精', 'spiritmaster': '精', 'elementallist': '精', 'elementalist': '精',
        'cleric': '治', 'chanter': '護',
        'painter': '彩', 'gunner': '槍', 'bard': '吟', 'rider': '機', 'thunderer': '雷'
    };

    // ID to Class Key Mapping
    const CLASS_ID_MAP = {
        '1': 'gladiator', '2': 'templar',
        '3': 'assassin', '4': 'ranger',
        '5': 'sorcerer', '6': 'spirit_master',
        '7': 'cleric', '8': 'chanter',
        '9': 'gunner', '10': 'bard', '11': 'rider', '12': 'painter', '13': 'thunderer'
    };

    // 排名類型對照表
    const RANKING_NAMES = {
        '0': '🏰 深淵',
        '1': '👻 夢魘',
        '2': '✨ 超越',
        '3': '🗡️ 單人競技場',
        '4': '⚔️ 協力競技場',
        '5': '🎯 征服',
        '6': '⚡ 覺醒'
    };

    const RANKING_KEY_MAP = {
        'abyss': '🏰 深淵',
        'nightmare': '👻 夢魘',
        'transcendence': '✨ 超越',
        'arena_solo': '🗡️ 單人競技場',
        'arena_team': '⚔️ 協力競技場',
        'conquest': '🎯 征服',
        'awakening': '⚡ 覺醒'
    };

    // 抓取數據
    async function fetchData(targetRegion) {
        const region = targetRegion || g_currentRegion;

        // 檢查快取是否有效
        if (_dataCache[region] && (Date.now() - _dataCache[region].timestamp < CACHE_TTL)) {
            console.log(`[ClassDist] Using cached data for region: ${region}`);
            return _dataCache[region].data;
        }

        // 防止同一區域的重複請求 (等待進行中的請求)
        if (_inflight[region]) {
            console.log(`[ClassDist] Waiting for in-flight request for region: ${region}`);
            return _inflight[region];
        }

        // 建立請求 Promise 並存入 inflight
        _inflight[region] = _fetchDataImpl(region);
        try {
            const result = await _inflight[region];
            return result;
        } finally {
            delete _inflight[region];
        }
    }

    async function _fetchDataImpl(region) {
        const baseUrl = "https://questlog.gg/aion-2/api/trpc";
        const input = encodeURIComponent(JSON.stringify({ region: region }));

        try {
            console.log(`[ClassDist] Fetching fresh data for region: ${region}`);

            const results = await Promise.allSettled([
                fetch(getProxyUrl(`${baseUrl}/armoryMeta.getClassDistribution?input=${input}`)),
                fetch(getProxyUrl(`${baseUrl}/armoryMeta.getRaceDistribution?input=${input}`)),
                fetch(getProxyUrl(`${baseUrl}/armoryMeta.getClassPerformanceMatrix?input=${input}`)),
                fetch(getProxyUrl(`${baseUrl}/armoryMeta.getArenaStats?input=${input}`)),
                fetch(getProxyUrl(`${baseUrl}/armoryMeta.getAbyssStats?input=${input}`))
            ]);

            async function parseResult(res) {
                if (res.status === 'fulfilled' && res.value.ok) {
                    try { return await res.value.json(); } catch (e) { return null; }
                }
                return null;
            }

            const classJson = await parseResult(results[0]);
            const raceJson = await parseResult(results[1]);
            const perfJson = await parseResult(results[2]);
            const arenaJson = await parseResult(results[3]);
            const abyssJson = await parseResult(results[4]);

            const result = {
                classData: classJson?.result?.data?.json || classJson?.result?.data,
                raceData: raceJson?.result?.data?.json || raceJson?.result?.data,
                perfData: perfJson?.result?.data?.json || perfJson?.result?.data,
                arenaData: arenaJson?.result?.data?.json || arenaJson?.result?.data,
                abyssData: abyssJson?.result?.data?.json || abyssJson?.result?.data
            };

            // 存入快取
            _dataCache[region] = { data: result, timestamp: Date.now() };
            console.log(`[ClassDist] Data cached for region: ${region}`);

            return result;
        } catch (e) {
            console.error("[ClassDist] Failed to fetch distribution data", e);
            return null;
        }
    }

    // 渲染種族分布條 (Elyos vs Asmodian)
    function renderRaceBar(data, containerId) {
        let raceData = data;
        let container = document.getElementById(containerId);

        // 如果 HTML 已經有該容器，就直接使用
        if (!container) {

            // 嘗試建立在伺服器分頁的最上層容器中 (tab-content-server)
            const tabContentServer = document.getElementById('tab-content-server');
            const serverChartContainer = document.getElementById('server-dist-chart-container');

            if (tabContentServer && serverChartContainer) {
                container = document.createElement('div');
                container.id = containerId;
                container.style.marginBottom = '20px';
                container.style.padding = '0 15px';
                // 插入在伺服器列表之前
                tabContentServer.insertBefore(container, serverChartContainer);
            } else {
                // 如果找不到伺服器分頁結構，才回退到舊位置 (Class Tab)
                const chartContainer = document.getElementById('class-dist-chart-container');
                if (chartContainer) {
                    container = document.createElement('div');
                    container.id = containerId;
                    container.style.marginBottom = '20px';
                    container.style.padding = '0 15px';
                    chartContainer.parentElement.insertBefore(container, chartContainer);
                } else {
                    return;
                }
            }
        }


        let elyosCount = 0;
        let asmodianCount = 0;

        if (Array.isArray(raceData)) {
            // Updated based on user feedback: raceId is "light" (Elyos) or "dark" (Asmodian)
            const eData = raceData.find(r => r.raceId === 'light' || r.race === 'elyos' || r.race === 'Elyos' || r.raceId === 0 || r.race === 'ELYOS');
            const aData = raceData.find(r => r.raceId === 'dark' || r.race === 'asmodian' || r.race === 'Asmodian' || r.raceId === 1 || r.race === 'ASMODIAN');

            if (eData) elyosCount = eData.count || eData.value || 0;
            if (aData) asmodianCount = aData.count || aData.value || 0;
        } else if (raceData) {
            elyosCount = raceData.light || raceData.elyos || raceData.Elyos || raceData.ELYOS || 0;
            asmodianCount = raceData.dark || raceData.asmodian || raceData.Asmodian || raceData.ASMODIAN || 0;
        }

        const total = elyosCount + asmodianCount;

        if (total === 0) {
            container.innerHTML = '<div style="text-align:center; color:#666; font-size:12px; padding:10px;">(暫無種族數據 - 請稍後再試)</div>';
            return;
        }

        const elyosPerc = ((elyosCount / total) * 100).toFixed(1);
        const asmodianPerc = ((asmodianCount / total) * 100).toFixed(1);

        // 判斷平衡狀態
        const diff = Math.abs(parseFloat(elyosPerc) - parseFloat(asmodianPerc));
        let statusHtml = '';
        if (diff <= 5) { // 差距 5% 內視為平衡
            statusHtml = `<span style="color:#2ecc71; font-size:12px; display:flex; align-items:center; gap:4px;"><span style="font-size:14px;"></span> 平衡</span>`;
        } else {
            statusHtml = `<span style="color:#e74c3c; font-size:12px; display:flex; align-items:center; gap:4px;"><span style="font-size:14px;"></span> 差距 ${(diff).toFixed(1)}%</span>`;
        }

        // 格式化數字 (直接顯示完整數字)
        const formatK = (num) => {
            return num.toLocaleString();
        };

        container.innerHTML = `
            <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:15px; margin-bottom:15px;">
                <!-- 上方資訊列 -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <!-- 左側：天族 -->
                    <div style="display:flex; align-items:center; gap:6px;">
                       
                        <span style="color:#3498db; font-weight:bold; font-size:15px;">天族 ${elyosPerc}%</span>
                    </div>

                    <!-- 中間：狀態 -->
                    <div>${statusHtml}</div>

                    <!-- 右側：魔族 -->
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="color:#e74c3c; font-weight:bold; font-size:15px;">${asmodianPerc}% 魔族</span>
                        
                    </div>
                </div>

                <!-- 進度條 -->
                <div style="display:flex; height:24px; border-radius:12px; overflow:hidden; background:#1a1f29; position:relative; cursor:default;">
                    
                    <!-- 天族 (藍) -->
                    <div title="天族: ${elyosCount.toLocaleString()} 人" style="width:${elyosPerc}%; background:#3498db; display:flex; align-items:center; justify-content:flex-end; padding-right:8px; position:relative;">
                        <span style="color:rgba(255,255,255,0.9); font-size:11px; font-weight:bold;">${formatK(elyosCount)}</span>
                    </div>

                    <!-- 魔族 (紅) -->
                    <div title="魔族: ${asmodianCount.toLocaleString()} 人" style="width:${asmodianPerc}%; background:#e74c3c; display:flex; align-items:center; justify-content:flex-start; padding-left:8px; position:relative;">
                        <span style="color:rgba(255,255,255,0.9); font-size:11px; font-weight:bold;">${formatK(asmodianCount)}</span>
                    </div>

                </div>
            </div>
        `;
    }

    // 渲染各排行榜職業佔比 (Class Representation by Ranking)
    function renderPerformanceMatrix(perfData, containerId) {
        let container = document.getElementById(containerId);
        const chartContainer = document.getElementById('class-dist-chart-container');

        // 確保容器存在
        if (!container) {
            if (chartContainer) {
                container = document.createElement('div');
                container.id = containerId;
            } else { return; }
        }

        // 強制移動到圖表上方 (即使容器已存在)
        if (container && chartContainer) {
            container.style.marginTop = '0px';
            container.style.marginBottom = '30px';
            // 下面這行會將 container 移動到 chartContainer 之前
            chartContainer.parentElement.insertBefore(container, chartContainer);
        }

        if (!perfData || Object.keys(perfData).length === 0) {
            container.innerHTML = '';
            return;
        }

        let html = `<h4 style="text-align:center; color:#fff; margin-bottom:20px; font-size:18px;">🔥 各排行榜職業分布與表現</h4>`;

        // 1. 建立全域圖例 (Global Legend) - 互動式
        const classOrder = [
            'gladiator', 'templar', 'assassin', 'ranger',
            'sorcerer', 'spirit_master',
            'cleric', 'chanter'
        ];

        // 定義 CSS 風格 (包含灰階與高亮邏輯)
        const styleId = 'class-dist-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                .cd-bar-segment { 
                    transition: all 0.2s ease; 
                    filter: grayscale(100%) opacity(0.5); 
                }
                .cd-bar-segment.active { 
                    filter: grayscale(0%) opacity(1); 
                    box-shadow: 0 0 8px rgba(255,255,255,0.4);
                    z-index: 10;
                }
                .cd-legend-item {
                    cursor: pointer;
                    opacity: 0.6;
                    transition: all 0.2s;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    padding: 2px 6px;
                }
                .cd-legend-item:hover, .cd-legend-item.active {
                    opacity: 1;
                    background: rgba(255,255,255,0.1);
                    border-color: rgba(255,255,255,0.2);
                }
            `;
            document.head.appendChild(style);
        }

        // Global Event Handlers
        window.highlightClass = function (classId) {
            // Highlight Legend
            document.querySelectorAll('.cd-legend-item').forEach(el => {
                const id = el.getAttribute('data-id');
                if (id === classId) el.classList.add('active');
                else el.classList.remove('active');
            });
            // Highlight Bars
            document.querySelectorAll('.cd-bar-segment').forEach(el => {
                const id = el.getAttribute('data-id');
                if (id === classId) el.classList.add('active');
                else el.classList.remove('active');
            });
        };

        window.resetHighlight = function () {
            // Default back to Gladiator
            window.highlightClass('gladiator');
        };


        let globalLegendHtml = '<div style="display:flex; flex-wrap:wrap; justify-content:center; gap:8px 16px; margin-bottom:25px; padding:10px; background:rgba(255,255,255,0.02); border-radius:8px;">';
        classOrder.forEach(key => {
            const name = CLASS_NAMES[key];
            const color = CLASS_COLORS[key];
            if (name && color) {
                globalLegendHtml += `
                    <div class="cd-legend-item" data-id="${key}" onmouseenter="highlightClass('${key}')" onclick="highlightClass('${key}')" style="display:flex; align-items:center; gap:6px; font-size:12px; color:#ccc;">
                        <span style="display:block; width:10px; height:10px; background:${color}; border-radius:2px;"></span>
                        <span>${name}</span>
                    </div>
                `;
            }
        });
        globalLegendHtml += '</div>';

        let contentHtml = '';

        const sortedKeys = Object.keys(perfData).sort((a, b) => parseInt(a) - parseInt(b));
        let hasContent = false;

        sortedKeys.forEach(key => {
            let subData = perfData[key];
            let rankingId = key;

            // 處理 API 回傳的嵌套結構 (例如: { classCounts: {...}, rankingType: 1 })
            let finalName = null;
            if (subData && typeof subData === 'object' && !Array.isArray(subData) && subData.classCounts) {
                rankingId = subData.rankingContentsType || subData.rankingType || subData.contentType || key;
                finalName = subData.rankingContentsName; // 嘗試取得 API 直接提供的名稱
                subData = subData.classCounts; // 取出真正的職業分佈數據
            }

            // 確保 rankingId 是原始型別，避免 [object Object]
            if (typeof rankingId === 'object') rankingId = key;

            const rankName = finalName || RANKING_NAMES[rankingId] || RANKING_KEY_MAP[rankingId] || `Ranking ${rankingId}`;

            let segments = [];

            if (Array.isArray(subData)) {
                segments = subData.map(d => {
                    let cId = d.classId || d.class || d.id;
                    if (cId && !isNaN(cId) && CLASS_ID_MAP[cId]) cId = CLASS_ID_MAP[cId];
                    return { id: cId, val: d.count || d.value || d.score || 0 };
                });
            } else if (typeof subData === 'object') {
                segments = Object.keys(subData).map(k => {
                    let cId = k;
                    if (cId && !isNaN(cId) && CLASS_ID_MAP[cId]) cId = CLASS_ID_MAP[cId];
                    return { id: cId, val: subData[k] };
                });
            }

            if (segments.length === 0) return;

            const total = segments.reduce((acc, curr) => acc + curr.val, 0);
            if (total === 0) return;

            hasContent = true;

            segments.sort((a, b) => b.val - a.val);

            // Bar Chart
            let barHtml = '';

            segments.forEach(seg => {
                const perc = ((seg.val / total) * 100).toFixed(1);
                const percNum = parseFloat(perc);

                if (percNum < 0.5) return;

                // FIX: Better key normalization
                let cKey = (seg.id && CLASS_ID_MAP[seg.id]) ? CLASS_ID_MAP[seg.id] : (seg.id || '').toLowerCase();
                if (cKey === 'spiritmaster' || cKey === 'elementalist') cKey = 'spirit_master'; // Force canonical name

                const color = CLASS_COLORS[cKey] || '#555';
                const fullName = CLASS_NAMES[cKey] || seg.id;
                // Bar 上只顯示百分比 (若空間足夠)
                const showLabel = percNum >= 3;

                barHtml += `
                    <div class="cd-bar-segment" data-id="${cKey}" style="width:${perc}%; background:${color}; height:100%; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden;" title="${fullName}: ${Math.round(percNum)}%">
                        ${showLabel ? `<span style="font-size:10px; color:rgba(255,255,255,0.9); font-weight:bold; text-shadow:0 0 2px rgba(0,0,0,0.8); pointer-events:none;">${Math.round(percNum)}%</span>` : ''}
                    </div>
                `;
            });

            contentHtml += `
                <div style="margin-bottom:15px;">
                    <div style="color:#e6edf3; font-size:13px; margin-bottom:5px; font-weight:bold;">${rankName}</div>
                    <div style="width:100%; height:10px; background:#222; border-radius:4px; overflow:hidden; display:flex;">
                        ${barHtml}
                    </div>
                </div>
            `;
        });

        if (!hasContent) {
            container.innerHTML = '<div style="text-align:center; color:#666; padding:20px;">暫無相關職業表現數據</div>';
        } else {
            container.innerHTML = html + globalLegendHtml + contentHtml;
            // 預設高亮劍星
            setTimeout(() => {
                if (window.highlightClass) window.highlightClass('gladiator');
            }, 100);
        }
    }

    // 渲染職業分布圖表
    function renderClassChart(classData, containerId) {
        const container = document.getElementById(containerId)?.parentElement;
        const canvas = document.getElementById(containerId);

        if (!canvas) return;

        if (window.classDistChart) {
            window.classDistChart.destroy();
            window.classDistChart = null;
        }

        if (!classData || classData.length === 0) {
            if (container) container.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#666;">無職業統計數據</div>';
            return;
        }

        const total = classData.reduce((acc, curr) => acc + curr.count, 0);

        classData.sort((a, b) => b.count - a.count);

        const labels = classData.map(d => CLASS_NAMES[d.classId] || d.classId);
        const values = classData.map(d => d.count);
        const percentages = classData.map(d => ((d.count / total) * 100).toFixed(1));
        const bgColors = classData.map(d => CLASS_COLORS[d.classId.toLowerCase()] || '#ccc');

        window.classDistChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '角色數量',
                    data: values,
                    backgroundColor: bgColors,
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.5
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 30, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#ddd',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function (context) {
                                const val = context.raw;
                                const perc = percentages[context.dataIndex];
                                return `${val.toLocaleString()} 人 (${perc}%)`;
                            }
                        }
                    },
                    datalabels: {
                        color: '#fff',
                        anchor: 'end',
                        align: 'end',
                        offset: 4,
                        formatter: (value, context) => {
                            return percentages[context.dataIndex] + '%';
                        },
                        font: { weight: 'bold', size: 11 },
                        textShadowBlur: 2,
                        textShadowColor: 'rgba(0,0,0,0.8)'
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#8b949e', font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#e6edf3', font: { weight: 'bold', size: 12 } }
                    }
                },
                layout: {
                    padding: { right: 40 }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // 更新 UI 按鈕狀態
    function updateRegionUI() {
        const btnTw = document.getElementById('region-btn-tw');
        const btnKo = document.getElementById('region-btn-ko');

        if (btnTw && btnKo) {
            const activeStyle = "background:#3b82f6; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;";
            const inactiveStyle = "background:transparent; color:#8b949e; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;";

            if (g_currentRegion === 'tw') {
                btnTw.style.cssText = activeStyle;
                btnKo.style.cssText = inactiveStyle;
            } else {
                btnTw.style.cssText = inactiveStyle;
                btnKo.style.cssText = activeStyle;
            }
        }
    }

    // 全局切換地區功能
    window.switchClassRegion = function (region) {
        if (g_currentRegion === region) return;
        g_currentRegion = region;

        updateRegionUI();
        window.renderClassDistributionTab();
    };



    // 主渲染函數
    window.renderClassDistributionTab = async function () {
        const container = document.getElementById('class-dist-chart-container');
        if (!container) return;

        // Update UI state just in case
        updateRegionUI();

        // Show loading state
        // data loads fast, maybe spinner isn't needed if hidden, but good UX
        // container.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#888;">載入數據中...</div>';

        const data = await fetchData();

        if (data) {
            /*
            // --- Race Data Rendering ---
            // Call internal render directly
            if (data.raceData) {
                const raceContainerId = 'race-dist-container';
                renderRaceBar(data.raceData, raceContainerId);
            }
            */

            // --- Class Data Rendering ---

            // --- Class Data Rendering ---
            let classData = data.classData;
            let perfData = data.perfData;

            if ((!classData || classData.length === 0)) {
                container.innerHTML = `<div style="text-align:center; color:#666; padding-top:20px;">無職業統計數據</div>`;
            } else {
                container.innerHTML = '<canvas id="class-dist-chart"></canvas>';
                renderClassChart(classData, 'class-dist-chart');
            }

            // --- Performance Matrix Rendering ---
            if (perfData) {
                renderPerformanceMatrix(perfData, 'class-perf-matrix');
            }

        } else {
            console.warn('[ClassDist] Fetch returned null');
            container.innerHTML = '<div style="text-align:center; padding:50px; color:#666;">無法從伺服器獲取數據<br><span style="font-size:12px;">(Fetch returned null)</span></div>';
        }
    };

})();
