(function () {
    const API_BASE = "https://aion-api.bnshive.com/stats";

    // Class Map
    const CLASS_MAP = {
        'GLADIATOR': '劍星', 'TEMPLAR': '守護星', 'ASSASSIN': '殺星', 'RANGER': '弓星',
        'SORCERER': '魔道星', 'SPIRIT_MASTER': '精靈星', 'SPIRITMASTER': '精靈星', 'ELEMENTALLIST': '精靈星',
        'CLERIC': '治癒星', 'CHANTER': '護法星',
        'PAINTER': '彩繪星', 'GUNNER': '槍擊星', 'BARD': '吟遊星', 'RIDER': '機甲星', 'THUNDERER': '雷擊星',
        '精靈星': '精靈星', '治癒星': '治癒星', '劍星': '劍星', '守護星': '守護星', '殺星': '殺星', '弓星': '弓星', '魔道星': '魔道星', '護法星': '護法星'
    };

    let SKILL_NAME_CACHE = {};
    let SKILL_NAMES_DB = {}; // 從 JSON 載入的完整技能名稱資料庫
    let dbLoaded = false;

    // 載入技能名稱資料庫
    async function loadSkillNamesDB() {
        if (dbLoaded) return;
        try {
            const res = await fetch('skill-names.json');
            if (res.ok) {
                SKILL_NAMES_DB = await res.json();
                dbLoaded = true;
                console.log(`[HealthCheck] 技能資料庫載入成功！共 ${Object.keys(SKILL_NAMES_DB).length} 個技能`);
            }
        } catch (e) {
            console.warn('[HealthCheck] 技能資料庫載入失敗:', e);
        }
    }

    function buildSkillNameCache(data) {
        let skills = data.skillList || (data.skill ? data.skill.skillList : []) || [];
        skills.forEach(s => {
            const skillId = s.skillId || s.id;
            if (skillId && s.name) {
                SKILL_NAME_CACHE[skillId] = s.name;
            }
        });
    }

    function getSkillName(id) {
        // Priority: User Cache > Skill Names DB > Global DB > Fallback
        if (SKILL_NAME_CACHE[id]) return SKILL_NAME_CACHE[id];
        if (SKILL_NAMES_DB[id]) return SKILL_NAMES_DB[id];
        if (window.SKILL_DATABASE && window.SKILL_DATABASE[id]) return window.SKILL_DATABASE[id].name;
        return `Skill ${id}`;
    }

    async function fetchAPI(endpoint, params = {}) {
        try {
            const url = new URL(`${API_BASE}/${endpoint}`);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('[HealthCheck] API Error:', e);
            return null;
        }
    }

    async function renderHealthCheck(data, minScore = null) {
        const container = document.getElementById('health-check-card');
        if (!container) return;

        container.style.display = 'block';
        buildSkillNameCache(data);

        // 確保技能資料庫已載入
        await loadSkillNamesDB();

        console.log('[HealthCheck] 完整 data:', data);

        // 🆕 自動判斷分段：根據道具等級
        let showLowLevelWarning = true; // 改為常駐顯示，永遠顯示提示框

        if (minScore === null) {
            // 嘗試從多個可能的位置取得道具等級
            let itemLevel = 0;

            // 方法1: 從 stat.statList 中找 ItemLevel
            if (data.stat && data.stat.statList) {
                const itemLevelStat = data.stat.statList.find(s => s.type === "ItemLevel");
                if (itemLevelStat) {
                    itemLevel = parseInt(itemLevelStat.value) || 0;
                }
            }

            // 方法2: 從 data.data.stat.statList 中找（嵌套結構）
            if (itemLevel === 0 && data.data && data.data.stat && data.data.stat.statList) {
                const itemLevelStat = data.data.stat.statList.find(s => s.type === "ItemLevel");
                if (itemLevelStat) {
                    itemLevel = parseInt(itemLevelStat.value) || 0;
                }
            }

            console.log('[HealthCheck] 偵測到道具等級:', itemLevel);

            // 根據道具等級自動判斷分段
            if (itemLevel >= 4000) {
                minScore = 4000;
            } else if (itemLevel >= 3500) {
                minScore = 3500;
            } else if (itemLevel >= 3000) {
                minScore = 3000;
            } else {
                // 低於 3000 或無法取得道具等級，預設使用 2500
                minScore = 2500;
            }

            console.log('[HealthCheck] 自動選擇分段:', minScore);
        }

        // 嘗試從多個可能的位置取得職業名稱
        let rawClass = data.playerClass
            || (data.profile && data.profile.className)
            || (data.data && data.data.profile && data.data.profile.className)
            || '';

        console.log('[HealthCheck] 原始 rawClass:', rawClass);

        if (typeof rawClass === 'string') rawClass = rawClass.trim().replace(/\s+/g, '_').toUpperCase();
        if (rawClass === 'SPIRITMASTER' || rawClass === 'ELEMENTALLIST') rawClass = 'SPIRIT_MASTER';

        console.log('[HealthCheck] 處理後 rawClass:', rawClass);

        const className = CLASS_MAP[rawClass] || rawClass;

        console.log('[HealthCheck] 最終 className:', className);

        if (!className || className === '') {
            console.error('[HealthCheck] ❌ 無法取得職業名稱');
            container.innerHTML = `<div style="padding:20px;text-align:center;color:#f00;">❌ 無法取得角色職業資訊</div>`;
            return;
        }

        if (!container.querySelector('.hc-content-area')) {
            container.innerHTML = `<div class="loader" style="padding:20px;text-align:center;color:#888;">載入 ${className} (${minScore}+) 數據中...</div>`;
        }

        const skillsData = await fetchAPI('skills', { className: className, itemMin: minScore, itemMax: 4500 });

        const style = `
            <style>
                #health-check-card { 
                    width: 100%; 
                    max-width: 100%; 
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .hc-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
                .hc-title { font-size: 18px; font-weight: bold; color: var(--gold); }
                .hc-score-select { 
                    background: #222; color: #fff; border: 1px solid #444; padding: 6px 12px; border-radius: 4px; font-size: 14px; cursor: pointer;
                }

                .hc-tab-header { display: flex; border-bottom: 2px solid #444; margin-bottom: 20px; }
                .hc-tab-btn { 
                    flex: 1; text-align: center; padding: 12px 0; cursor: pointer; color: #888; font-size: 16px;
                    border-bottom: 2px solid transparent; margin-bottom: -2px; transition: 0.2s;
                }
                .hc-tab-btn.active { color: #ffce56; border-bottom-color: #ffce56; font-weight: bold; }
                .hc-tab-content { display: none; }
                .hc-tab-content.active { display: block; }

                .bf-row { display: flex; align-items: center; margin-bottom: 8px; min-height: 28px; }
                .bf-col { flex: 1; display: flex; flex-direction: column; justify-content: center; }
                .bf-col-left { align-items: flex-end; padding-right: 10px; border-right: 1px dashed #444; }
                .bf-col-right { align-items: flex-start; padding-left: 10px; }
                .bf-name { font-size: 13px; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
                .bf-val { font-size: 11px; color: #ff9f43; font-weight: bold; }
                .match-highlight { color: #2ed573; font-weight:bold; }
                .skill-bar { width: 80px; height: 8px; }
                .skill-name { font-size: 14px; max-width: 160px; }
                .skill-row { margin-bottom: 10px; padding-left: 15px; padding-right: 15px; }

                /* 手機版 RWD */
                @media (max-width: 768px) {
                    #health-check-card { 
                        width: 100% !important;
                        max-width: 100% !important;
                        min-width: 0 !important;
                        box-sizing: border-box !important;
                    }
                    .hc-header-row { gap: 8px; }
                    .hc-title { font-size: 14px; flex: 1; min-width: 0; }
                    .hc-score-select { font-size: 12px; padding: 4px 8px; }
                    .hc-tab-btn { font-size: 13px; padding: 8px 0; }
                    .hc-header-row { margin-bottom: 10px; }
                    .hc-tab-header { margin-bottom: 12px; }
                    .hc-content-area { padding: 10px !important; }
                    .bf-name { font-size: 11px; max-width: 80px; }
                    .bf-val { font-size: 9px; }
                    .bf-col-left { padding-right: 6px; }
                    .bf-col-right { padding-left: 6px; }
                    .skill-bar { width: 50px !important; height: 6px !important; }
                    .skill-name { font-size: 11px !important; max-width: 70px !important; }
                    .skill-row { margin-bottom: 6px !important; padding-left: 8px !important; padding-right: 8px !important; }
                }
            </style>
        `;

        const renderTabContent = async (categoryKey) => {
            let serverTypes = [categoryKey];
            if (categoryKey === 'stigma') serverTypes = ['stigma', 'dp'];

            let serverList = [];

            console.log(`[HealthCheck] 渲染 ${categoryKey} 分類`);
            console.log(`[HealthCheck] skillsData:`, skillsData);
            console.log(`[HealthCheck] SKILL_NAMES_DB 已載入:`, dbLoaded, '技能數量:', Object.keys(SKILL_NAMES_DB).length);

            if (skillsData && skillsData.skills) {
                const filtered = skillsData.skills.filter(s => serverTypes.includes(s.type));
                console.log(`[HealthCheck] ${categoryKey} 篩選後技能數:`, filtered.length);

                serverList = filtered
                    .sort((a, b) => (b.avgLevel || 0) - (a.avgLevel || 0))
                    .slice(0, 5)
                    .map(s => {
                        const skillName = getSkillName(s.skillId);
                        console.log(`[HealthCheck] Skill ${s.skillId} -> ${skillName} (Lv.${s.avgLevel})`);
                        return {
                            id: s.skillId,
                            name: skillName,
                            avgLv: s.avgLevel || 0
                        };
                    });
            }

            console.log(`[HealthCheck] ${categoryKey} serverList:`, serverList);

            let rawUserSkills = data.skillList || (data.skill ? data.skill.skillList : []) || [];

            console.log(`[HealthCheck] 使用者總技能數:`, rawUserSkills.length);

            let userList = rawUserSkills
                .map(s => {
                    // 先嘗試從 API 資料中找到對應的技能類型
                    const userSkillId = s.skillId || s.id;
                    let skillType = (s.type || '').toLowerCase();

                    if (!skillType && skillsData && skillsData.skills) {
                        const apiSkill = skillsData.skills.find(x => x.skillId === userSkillId);
                        if (apiSkill) {
                            skillType = apiSkill.type;
                        }
                    }

                    return {
                        ...s,
                        skillId: userSkillId,
                        detectedType: skillType
                    };
                })
                .filter(s => {
                    const uType = s.detectedType;

                    if (categoryKey === 'stigma') {
                        const match = uType === 'stigma' || uType === 'dp' || uType === 'devotion' || uType === 'special';
                        if (match) console.log(`[HealthCheck] ✓ ${categoryKey} 匹配:`, s.name, `(${uType})`);
                        return match;
                    }

                    if (uType === categoryKey) {
                        console.log(`[HealthCheck] ✓ ${categoryKey} 匹配:`, s.name, `(${uType})`);
                        return true;
                    }

                    // 如果是 active 且沒有類型，預設為 active
                    if (categoryKey === 'active' && !uType) {
                        console.log(`[HealthCheck] ✓ ${categoryKey} 預設匹配:`, s.name);
                        return true;
                    }

                    return false;
                })
                .sort((a, b) => b.skillLevel - a.skillLevel)
                .slice(0, 5)
                .map(s => ({
                    id: s.skillId || s.id,
                    name: s.name || getSkillName(s.skillId || s.id),
                    lv: s.skillLevel
                }));

            console.log(`[HealthCheck] ${categoryKey} 使用者篩選後:`, userList.length, '個技能');

            while (serverList.length < 5) serverList.push({ name: '-', avgLv: 0 });
            while (userList.length < 5) userList.push({ name: '-', lv: 0 });

            // 計算最大值用於比例尺
            const maxServerLv = Math.max(...serverList.map(s => s.avgLv), 1);
            const maxUserLv = Math.max(...userList.map(u => u.lv), 1);

            let html = `<div style="padding:15px 0;">
                <div style="font-size:13px; color:#aaa; margin-bottom:12px; text-align:center;">
                    <span style="color:#2ed573; font-weight:bold;">綠色名稱</span> 代表該技能也是全服 Top 5 熱門技能
                </div>
                <div style="display:flex; font-size:13px; color:#ddd; margin-bottom:12px; border-bottom:1px solid #444; padding-bottom:8px; font-weight:bold;">
                    <div style="flex:1; text-align:right; padding-right:20px;">全服 Top 5 (最高等級)</div>
                    <div style="flex:1; padding-left:20px;">我的 Top 5 (目前等級)</div>
                </div>`;

            for (let i = 0; i < 5; i++) {
                const s = serverList[i];
                const u = userList[i];

                // 計算長條寬度百分比
                const serverWidth = s.avgLv > 0 ? (s.avgLv / maxServerLv * 100) : 0;
                const userWidth = u.lv > 0 ? (u.lv / maxUserLv * 100) : 0;

                // 檢查是否匹配
                const sInUser = s.id && userList.some(x => x.id === s.id);
                const uInServer = u.id && serverList.some(x => x.id === u.id);

                html += `
                <div class="skill-row" style="display:flex; align-items:center; min-height:32px;">
                    <!-- 左邊：全服 [Name Lv] [Bar] -->
                    <div style="flex:1; display:flex; justify-content:flex-end; align-items:center; border-right:1px solid #444;">
                        <div style="text-align:right; margin-right:8px;">
                            <div class="skill-name" style="color:${s.name !== '-' ? (sInUser ? '#2ed573' : '#eee') : '#666'}; font-weight:${sInUser ? 'bold' : 'normal'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</div>
                            ${s.avgLv > 0 ? `<div style="font-size:11px; color:#4a9eff; margin-top:2px;">Lv.${s.avgLv.toFixed(1)}</div>` : ''}
                        </div>
                        <div class="skill-bar" style="background:#2a2a2a; border-radius:4px; position:relative; overflow:hidden;">
                            <div style="position:absolute; right:0; top:0; height:100%; width:${serverWidth}%; background:linear-gradient(90deg, #2563eb, #4a9eff);"></div>
                        </div>
                    </div>
                    
                    <!-- 右邊：我的 [Bar] [Name Lv] -->
                    <div style="flex:1; display:flex; justify-content:flex-start; align-items:center;">
                        <div class="skill-bar" style="background:#2a2a2a; border-radius:4px; position:relative; overflow:hidden;">
                            <div style="position:absolute; left:0; top:0; height:100%; width:${userWidth}%; background:linear-gradient(90deg, #ff9f43, #ff6b35);"></div>
                        </div>
                        <div style="text-align:left; margin-left:8px;">
                            <div class="skill-name" style="color:${u.name !== '-' ? (uInServer ? '#2ed573' : '#eee') : '#666'}; font-weight:${uInServer ? 'bold' : 'normal'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.name}</div>
                            ${u.lv > 0 ? `<div style="font-size:11px; color:#ff9f43; margin-top:2px;">Lv.${u.lv}</div>` : ''}
                        </div>
                    </div>
                </div>`;
            }
            html += `</div>`;
            return html;
        };

        const activeHtml = await renderTabContent('active');
        const passiveHtml = await renderTabContent('passive');
        const stigmaHtml = await renderTabContent('stigma');

        // 🆕 低等級提示框 HTML
        const warningHtml = showLowLevelWarning ? `
            <div style="background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.4); border-radius: 6px; padding: 8px 12px; margin-bottom: 15px; display: flex; align-items: flex-start; gap: 8px; max-width: 100%; box-sizing: border-box;">
                <span style="font-size: 18px; flex-shrink: 0;">⚠️</span>
                <div style="flex: 1; min-width: 0; word-break: break-word; overflow-wrap: break-word;">
                    <div style="color: #ffc107; font-weight: bold; font-size: 13px; margin-bottom: 3px;">道具等級偵測</div>
                    <div style="color: #e0e0e0; font-size: 12px; line-height: 1.5;">您的道具等級若低於2500 或無法取得時，會預設為 <b style="color: #ffc107;">2500+分段</b></div>
                </div>
            </div>
        ` : '';

        const finalHtml = `
            <div class="hc-header-row">
                <div class="hc-title">📋 ${className} 技能健檢</div>
                <select class="hc-score-select" onchange="window.updateHcScore(this.value)">
                    <option value="2500" ${minScore == 2500 ? 'selected' : ''}>2500+ 分段</option>
                    <option value="3000" ${minScore == 3000 ? 'selected' : ''}>3000+ 分段</option>
                    <option value="3500" ${minScore == 3500 ? 'selected' : ''}>3500+ 分段</option>
                    <option value="4000" ${minScore == 4000 ? 'selected' : ''}>4000+ 分段</option>
                </select>
            </div>
            
            ${warningHtml}
            
            <div class="hc-content-area" style="background:rgba(0,0,0,0.2); border-radius:8px; padding:15px;">
                <div class="hc-tab-header">
                    <div class="hc-tab-btn active" onclick="switchHcTab('active')">主動</div>
                    <div class="hc-tab-btn" onclick="switchHcTab('passive')">被動</div>
                    <div class="hc-tab-btn" onclick="switchHcTab('stigma')">烙印/特殊</div>
                </div>
                
                <div id="tab-active" class="hc-tab-content active">${activeHtml}</div>
                <div id="tab-passive" class="hc-tab-content">${passiveHtml}</div>
                <div id="tab-stigma" class="hc-tab-content">${stigmaHtml}</div>
                
                
            </div>`;

        container.innerHTML = style + finalHtml;

        if (!window.switchHcTab) {
            window.switchHcTab = function (tabName) {
                document.querySelectorAll('.hc-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.hc-tab-content').forEach(c => c.classList.remove('active'));
                const map = { 'active': 0, 'passive': 1, 'stigma': 2 };
                document.querySelectorAll('.hc-tab-btn')[map[tabName]].classList.add('active');
                document.getElementById('tab-' + tabName).classList.add('active');
            };
        }
        window.updateHcScore = function (score) {
            renderHealthCheck(window.lastData, parseInt(score));
        };
    }

    const hookFunc = () => {
        const run = (d) => {
            window.lastData = d;
            if ((!d.skillList && !d.skill) || (d.skillList && d.skillList.length === 0)) setTimeout(() => renderHealthCheck(d), 1000);
            renderHealthCheck(d);
        };
        if (window.renderCombatAnalysis) {
            const org = window.renderCombatAnalysis;
            window.renderCombatAnalysis = function (s, d) { org(s, d); run(d); };
            if (window.lastData) run(window.lastData);
        } else if (window.renderTrendChart) {
            const org = window.renderTrendChart;
            window.renderTrendChart = function (j, t) { org(j, t); run(j); };
        }
    };

    // 立即載入技能資料庫
    loadSkillNamesDB();

    hookFunc();
    console.log("Health Check v32.0 (Dual Column Layout) loaded.");
})();
