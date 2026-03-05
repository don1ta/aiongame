/**
 * Aion2 技能健檢分析模組 (health_check.js)
 * 
 * 此檔案負責「技能健檢」功能，其核心功能為：
 * 1. 抓取全服數據：從 API 取得同職業段前段玩家的技能配置統計。
 * 2. 數據對比：將當前使用者的技能等級與全服 Top 5 熱門技能進行橫向對比。
 * 3. 視覺化呈現：以長條圖形式展現技能強度差異，並提供等級差異參考。
 * 4. 動態掛載：自動偵測主程式數據更新並即時刷新健檢內容。
 */

(function () {
    const API_BASE = "https://aion-api.bnshive.com/stats";

    // ── 快取設定：全服技能統計不常變動，30 分鐘內使用快取 ──
    const STATS_CACHE_PREFIX = 'aion_hc_stats_v1_';
    const STATS_CACHE_TTL = 30 * 60 * 1000; // 30 分鐘

    function getStatsCache(className, minScore) {
        try {
            const key = `${STATS_CACHE_PREFIX}${className}_${minScore}`;
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() - parsed.timestamp > STATS_CACHE_TTL) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) { return null; }
    }

    function setStatsCache(className, minScore, data) {
        try {
            const key = `${STATS_CACHE_PREFIX}${className}_${minScore}`;
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) { }
    }

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

    // 載入技能名稱資料庫 (改由靜態預載)
    async function loadSkillNamesDB() {
        if (dbLoaded) return;
        if (window.SKILL_NAMES_DB) {
            SKILL_NAMES_DB = window.SKILL_NAMES_DB;
            dbLoaded = true;
        } else {
            try {
                const res = await fetch('skill-names.json');
                if (res.ok) {
                    SKILL_NAMES_DB = await res.json();
                    dbLoaded = true;
                }
            } catch (e) {
            }
        }
    }

    function buildSkillNameCache(data) {
        let skills = data.skillList || (data.skill ? data.skill.skillList : []) || (data.skills ? (Array.isArray(data.skills) ? data.skills : data.skills.skillList) : []) || [];
        skills.forEach(s => {
            const skillId = s.skillId || s.id;
            if (skillId && s.name) {
                SKILL_NAME_CACHE[skillId] = s.name;
            }
        });
    }

    function getSkillName(id) {
        if (SKILL_NAME_CACHE[id]) return SKILL_NAME_CACHE[id];
        if (SKILL_NAMES_DB[id]) return SKILL_NAMES_DB[id];
        if (window.SKILL_DATABASE && window.SKILL_DATABASE[id]) return window.SKILL_DATABASE[id].name;
        return `Skill ${id}`;
    }

    function getProxyUrl(url) {
        return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;
    }

    async function fetchAPI(endpoint, params = {}) {
        try {
            const url = new URL(`${API_BASE}/${endpoint}`);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            const proxyUrl = getProxyUrl(url.toString());
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    async function renderHealthCheck(inputData, minScore = null) {
        const container = document.getElementById('health-check-card');
        if (!container) return;

        // 兼容不同的數據包裹層次
        const data = inputData.queryResult ? inputData.queryResult.data : (inputData.data ? inputData.data : inputData);

        container.style.display = 'block';
        buildSkillNameCache(data);
        await loadSkillNamesDB();

        if (minScore === null) {
            let itemLevel = 0;
            const statList = (data.stat && data.stat.statList) ? data.stat.statList : [];
            const itemLevelStat = statList.find(s => s.type === "ItemLevel");
            if (itemLevelStat) itemLevel = parseInt(itemLevelStat.value) || 0;

            if (itemLevel >= 4000) minScore = 4000;
            else if (itemLevel >= 3500) minScore = 3500;
            else if (itemLevel >= 3000) minScore = 3000;
            else minScore = 2500;
        }

        let rawClass = data.playerClass
            || (data.profile && data.profile.className)
            || (data.className)
            || '';


        if (typeof rawClass === 'string') rawClass = rawClass.trim().replace(/\s+/g, '_').toUpperCase();
        if (rawClass === 'SPIRITMASTER' || rawClass === 'ELEMENTALLIST') rawClass = 'SPIRIT_MASTER';
        const className = CLASS_MAP[rawClass] || rawClass;

        if (!className || className === '') {
            container.innerHTML = `<div style="padding:20px;text-align:center;color:#f00;">❌ 無法取得角色職業資訊</div>`;
            return;
        }

        if (!container.querySelector('.hc-content-area')) {
            container.innerHTML = `<div class="loader" style="padding:20px;text-align:center;color:#888;">載入 ${className} (${minScore}+) 數據中...</div>`;
        }

        // 先查快取，有的話直接用
        let skillsData = getStatsCache(className, minScore);
        if (!skillsData) {
            skillsData = await fetchAPI('skills', { className: className, itemMin: minScore, itemMax: 4500 });
            if (skillsData) setStatsCache(className, minScore, skillsData);
        }

        const style = `
            <style>
                #health-check-card { width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden; }
                .hc-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
                .hc-title { font-size: 18px; font-weight: bold; color: var(--gold); }
                .hc-score-select { background: #222; color: #fff; border: 1px solid #444; padding: 6px 12px; border-radius: 4px; font-size: 14px; cursor: pointer; }
                .hc-tab-header { display: flex; border-bottom: 2px solid #444; margin-bottom: 20px; }
                .hc-tab-btn { flex: 1; text-align: center; padding: 12px 0; cursor: pointer; color: #888; font-size: 16px; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: 0.2s; }
                .hc-tab-btn.active { color: #ffce56; border-bottom-color: #ffce56; font-weight: bold; }
                .hc-tab-content { display: none; }
                .hc-tab-content.active { display: block; }
                .skill-row { margin-bottom: 10px; padding: 0 15px; }
                .skill-bar { width: 80px; height: 8px; background: #2a2a2a; border-radius: 4px; position: relative; overflow: hidden; flex-shrink: 0; }
                .skill-name { font-size: 14px; width: 100%; }
                @media (max-width: 768px) {
                    .hc-title { font-size: 14px; }
                    .hc-score-select { font-size: 12px; padding: 4px 8px; }
                    .hc-tab-btn { font-size: 13px; padding: 8px 0; }
                    .skill-bar { width: 50px !important; }
                    .skill-name { font-size: 11px !important; }
                }
            </style>
        `;

        const renderTabContent = async (categoryKey) => {
            let serverTypes = [categoryKey];
            if (categoryKey === 'stigma') serverTypes = ['stigma', 'dp'];
            let serverList = [];

            if (skillsData && skillsData.skills) {
                serverList = skillsData.skills.filter(s => serverTypes.includes(s.type))
                    .sort((a, b) => (b.avgLevel || 0) - (a.avgLevel || 0))
                    .slice(0, 5)
                    .map(s => ({
                        id: s.skillId,
                        name: getSkillName(s.skillId),
                        avgLv: s.avgLevel || 0
                    }));
            }

            let rawUserSkills = data.skillList || (data.skill ? data.skill.skillList : []) || (data.skills ? (Array.isArray(data.skills) ? data.skills : data.skills.skillList) : []) || [];
            let userList = rawUserSkills.map(s => {
                const userSkillId = s.skillId || s.id;
                let skillType = (s.type || s.category || '').toLowerCase();
                if (!skillType && skillsData && skillsData.skills) {
                    const apiSkill = skillsData.skills.find(x => x.skillId === userSkillId);
                    if (apiSkill) skillType = apiSkill.type;
                }
                return { ...s, skillId: userSkillId, detectedType: skillType };
            }).filter(s => {
                const uType = s.detectedType;
                if (categoryKey === 'stigma') return (uType === 'stigma' || uType === 'dp' || uType === 'devotion' || uType === 'special');
                if (uType === categoryKey) return true;
                if (categoryKey === 'active' && !uType) return true;
                return false;
            }).sort((a, b) => (b.skillLevel || b.level || 0) - (a.skillLevel || a.level || 0))
                .slice(0, 5)
                .map(s => ({
                    id: s.skillId || s.id,
                    name: s.name || getSkillName(s.skillId || s.id),
                    lv: s.skillLevel || s.level || 0
                }));

            while (serverList.length < 5) serverList.push({ name: '-', avgLv: 0 });
            while (userList.length < 5) userList.push({ name: '-', lv: 0 });

            const maxServerLv = Math.max(...serverList.map(s => s.avgLv), 1);
            const maxUserLv = Math.max(...userList.map(u => u.lv), 1);

            let html = `<div style="padding:15px 0;">
                <div style="font-size:13px; color:#aaa; margin-bottom:12px; text-align:center;">
                    <span style="color:#2ed573; font-weight:bold;">綠色名稱</span> 代表該技能也是全服 Top 5 熱門技能
                </div>
                <div style="display:flex; font-size:12px; color:#aaa; margin-bottom:12px; border-bottom:1px solid #444; padding-bottom:8px; font-weight:bold;">
                    <div style="flex:0 0 50%; text-align:right; padding-right:12px;">全服 Top 5 (最高等級)</div>
                    <div style="flex:0 0 50%; padding-left:12px;">我的 Top 5 (目前等級)</div>
                </div>`;

            for (let i = 0; i < 5; i++) {
                const s = serverList[i];
                const u = userList[i];
                const serverWidth = s.avgLv > 0 ? (s.avgLv / maxServerLv * 100) : 0;
                const userWidth = u.lv > 0 ? (u.lv / maxUserLv * 100) : 0;
                const sInUser = s.id && userList.some(x => x.id === s.id);
                const uInServer = u.id && serverList.some(x => x.id === u.id);

                html += `
                <div class="skill-row" style="display:flex; align-items:center; min-height:36px;">
                    <div style="flex: 1 1 50%; display:flex; justify-content:flex-end; align-items:center; border-right:1px solid #444; padding-right:10px;">
                        <div style="flex: 1; text-align:right; margin-right:8px; min-width:0;">
                            <div class="skill-name" style="color:${s.name !== '-' ? (sInUser ? '#2ed573' : '#eee') : '#666'}; font-weight:${sInUser ? 'bold' : 'normal'}; line-height: 1.3;">${s.name}</div>
                            ${s.avgLv > 0 ? `<div style="font-size:11px; color:#4a9eff; margin-top:2px;">Lv.${s.avgLv.toFixed(1)}</div>` : ''}
                        </div>
                        <div class="skill-bar"><div style="position:absolute; right:0; top:0; height:100%; width:${serverWidth}%; background:linear-gradient(90deg, #2563eb, #4a9eff);"></div></div>
                    </div>
                    <div style="flex: 1 1 50%; display:flex; justify-content:flex-start; align-items:center; padding-left:10px;">
                        <div class="skill-bar"><div style="position:absolute; left:0; top:0; height:100%; width:${userWidth}%; background:linear-gradient(90deg, #ff9f43, #ff6b35);"></div></div>
                        <div style="flex: 1; text-align:left; margin-left:8px; min-width:0;">
                            <div class="skill-name" style="color:${u.name !== '-' ? (uInServer ? '#2ed573' : '#eee') : '#666'}; font-weight:${uInServer ? 'bold' : 'normal'}; line-height: 1.3;">${u.name}</div>
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

        const warningHtml = `
            <div style=" border: 1px solid rgba(255, 193, 7, 0.4); border-radius: 6px; padding: 8px 12px; margin-bottom: 15px; display: flex; align-items: flex-start; gap: 8px;">
                <span style="font-size: 18px;">⚠️</span>
                <div style="flex: 1;">
                    <div style="color: #ffc107; font-weight: bold; font-size: 13px; margin-bottom: 3px;">道具等級偵測</div>
                    <div style="color: #e0e0e0; font-size: 12px; line-height: 1.5;">您的道具等級若低於2500 或無法取得時，會預設為 <b style="color: #ffc107;">2500+分段</b></div>
                </div>
            </div>`;

        container.innerHTML = style + `
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
            renderHealthCheck(d);
        };
        // 增強鉤子：如果 window.renderCombatAnalysis 還沒被定義，則定時檢查
        const tryHook = () => {
            if (window.renderCombatAnalysis) {
                const org = window.renderCombatAnalysis;
                window.renderCombatAnalysis = function (s, d) { org(s, d); run(d); };
                if (window.lastData) run(window.lastData);
                // console.log("[HealthCheck] Successfully hooked renderCombatAnalysis");
            } else {
                setTimeout(tryHook, 500);
            }
        };
        tryHook();
    };

    loadSkillNamesDB();
    hookFunc();
})();
