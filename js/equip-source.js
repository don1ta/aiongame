/**
 * Aion2 裝備來源評分明細系統 (equip-source.js)
 * 
 * 功能：針對各項裝備評分進行具體細項拆解並渲染
 * - 分頁1：裝備等級 - 顯示每件裝備的等級分數、強化/突破/神石/磨石明細
 * - 分頁2：守護力獲取 - 顯示各板塊進度與評分
 */

// ============================================================
// 🔧 評分輔助函數
// ============================================================

/**
 * 取得裝備位置顯示名稱 (修正版)
 */
function getSlotDisplayName(slot) {
    const slotMap = {
        1: '武器', 2: '臂甲', 3: '頭盔', 4: '肩甲', 5: '胸甲',
        6: '腿甲', 7: '手套', 8: '鞋子', 9: '項鍊', 10: '耳環1',
        11: '耳環2', 12: '戒指1', 13: '戒指2', 14: '腰帶',
        15: '手鐲1', 16: '手鐲2', 17: '羽毛', 19: '披風'
    };
    if (slot === 0) return '武器'; // 相容性處理
    if (slotMap[slot]) return slotMap[slot];
    if (slot >= 41 && slot <= 46) return '聖杯' + (slot - 40);
    return '其他';
}

function getGodStoneScore(grade) {
    const g = (grade || '').toString().toLowerCase();
    const gNum = parseInt(g);
    if (gNum >= 41 || g.includes('unique') || g.includes('唯一') || g.includes('獨特')) return 10;
    if (gNum >= 31 || g.includes('legend') || g.includes('epic') || g.includes('傳說') || g.includes('傳承') || g.includes('史詩')) return 5;
    if (gNum >= 21 || g.includes('rare') || g.includes('稀有')) return 3;
    return 0;
}

function getMagicStoneScore(grade) {
    const g = (grade || '').toString().toLowerCase();
    const gNum = parseInt(g);
    if (gNum >= 41 || g.includes('unique') || g.includes('唯一') || g.includes('獨特')) return 4;
    if (gNum >= 31 || g.includes('legend') || g.includes('epic') || g.includes('傳說') || g.includes('傳承') || g.includes('史詩') || g.includes('special')) return 3;
    if (gNum >= 11 || g.includes('rare') || g.includes('稀有')) return 2;
    return 1;
}

function getCardScore(grade) {
    const g = (grade || '').toString().toLowerCase();
    const gNum = parseInt(g);
    if (gNum >= 41 || g.includes('unique') || g.includes('專屬')) return 80;
    if (gNum >= 31 || g.includes('legend') || g.includes('史詩')) return 60;
    if (gNum >= 21 || g.includes('rare') || g.includes('稀有')) return 40;
    return 20;
}

function getEscGradeColor(grade) {
    const g = (grade || '').toString().toLowerCase();
    const gNum = parseInt(g);
    if (gNum >= 51 || g.includes('myth')) return '#e67e22';
    if (gNum >= 41 || g.includes('unique')) return '#f1c40f';
    if (gNum >= 31 || g.includes('legend')) return '#3498db';
    if (gNum >= 21 || g.includes('rare')) return '#2ecc71';
    return '#adb5bd';
}

/**
 * 計算單件裝備的評分明細
 */
function calcItemDetailScore(item, equipMap) {
    const d = item.detail;
    if (!d || !d.name) return null;

    const slot = item.slotPos;
    const originalItem = (equipMap && equipMap[slot]) ? equipMap[slot] : item;

    // 1. 基礎分數判斷
    const isArcana = (slot >= 41 && slot <= 46);
    let baseScore = 0;

    if (isArcana) {
        // 聖杯卡片：分數 = 品階分
        baseScore = getCardScore(d.grade || d.quality || 'common');
    } else {
        // 一般裝備：分數 = 等級
        baseScore = d.level || 0;
    }

    // 2. 強化分數 (強化 +5 = +5分)
    const enchantLv = originalItem.enchantLevel || d.enchantLevel || 0;
    const enchantScore = enchantLv; // 1級 = 1分

    // 3. 突破分數 (每次 +5分)
    const exceedLv = originalItem.exceedLevel || d.exceedLevel || 0;
    const breakthroughScore = exceedLv * 5;

    // 4. 神石分數
    const godStones = d.godStoneStat || [];
    let godStoneScore = 0;
    const godStoneDetails = godStones.map(gs => {
        const sc = getGodStoneScore(gs.grade);
        godStoneScore += sc;
        return { name: gs.name, grade: gs.grade, score: sc };
    });

    // 5. 磨石分數
    const magicStones = d.magicStoneStat || [];
    let magicStoneScore = 0;
    const magicStoneDetails = magicStones.map(ms => {
        const sc = getMagicStoneScore(ms.grade);
        magicStoneScore += sc;
        return { name: ms.name, grade: ms.grade, score: sc };
    });

    // 總分計算
    const total = Math.round((baseScore + enchantScore + breakthroughScore + godStoneScore + magicStoneScore) * 10) / 10;

    return {
        name: d.name || '未知',
        slot: slot,
        level: d.level || 0,
        enchantLevel: enchantLv,
        exceedLevel: exceedLv,
        color: getEscGradeColor(d.grade || d.quality),
        levelScore: baseScore,
        enchantScore: enchantScore,
        breakthroughScore: breakthroughScore,
        godStoneScore: godStoneScore,
        magicStoneScore: magicStoneScore,
        total: total,
        slotName: getSlotDisplayName(slot)
    };
}

// ============================================================
// 🔄 渲染與切換
// ============================================================

window.switchEquipSourceTab = function (tab) {
    ['equip', 'board', 'misc'].forEach(t => {
        const btn = document.getElementById('esc-tab-btn-' + t);
        const pane = document.getElementById('esc-tab-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
        if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
    });
};

/**
 * 🏰 守護力獲取 (明細表格)
 */
async function loadDaevanionScoreDetails(json) {
    const boardIds = [71, 72, 73, 74, 75, 76, 77];
    const container = document.getElementById('esc-board-content');
    if (!container) return { total: 0 };

    function deepSearch(obj, key) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj[key] !== undefined) return obj[key];
        for (const k in obj) {
            const res = deepSearch(obj[k], key);
            if (res) return res;
        }
        return null;
    }

    // 🏆 超級寬容路徑：對齊 aion.js 並增加深度搜尋備案
    const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
    const deBoardList = (data && data.daevanionBoardList) || 
                       (json.queryResult && json.queryResult.daevanionBoardList) || 
                       deepSearch(json, 'daevanionBoardList') || [];

    const deDetailsList = (data && data.daevanionDetails) || 
                         (json.queryResult && json.queryResult.daevanionDetails) || 
                         deepSearch(json, 'daevanionDetails') || [];
    
    // 取得職業 (ClassName)，用於判斷被動技能
    const charProfile = (data && data.charProfile) || (data && data.profile) || (data && data.info) || deepSearch(json, 'charProfile') || deepSearch(json, 'profile') || {};
    const className = (charProfile.className || charProfile.class_name || "").toString().trim().replace(/\s/g, '');

    // 取得被動技能資料庫 (用於判斷綠色/藍色)
    const passiveDB = window.PASSIVE_SKILLS_DB || {};
    const classPassives = (className && passiveDB[className]) ? new Set(Object.keys(passiveDB[className])) : new Set();
    const allPassives = new Set();
    Object.values(passiveDB).forEach(cls => {
        Object.keys(cls).forEach(skillName => allPassives.add(skillName));
    });

    const boardConfigMap = {
        '奈薩肯': { id: 71, s: ['戰鬥速度', '冷卻時間減少'], v: 2.5, tOra: 4, tBlu: 12, tGre: 10, tMax: 88 },
        '吉凱爾': { id: 72, s: ['傷害耐性', '傷害增幅'], v: 5, tOra: 4, tBlu: 12, tGre: 10, tMax: 88 },
        '白傑爾': { id: 73, s: ['暴擊傷害增幅', '暴擊傷害耐性'], v: 5, tOra: 4, tBlu: 12, tGre: 10, tMax: 88 },
        '崔妮爾': { id: 74, s: ['多段打擊抵抗', '多段打擊擊中'], v: 3, tOra: 6, tBlu: 12, tGre: 10, tMax: 116 },
        '艾瑞爾': { id: 75, s: ['PVE傷害增幅', 'PVE傷害抵抗', 'PVE傷害耐性'], b: ['首領傷害耐性', '首領傷害增幅'], v: 2.5, tOra: 6, tBlu: 16, tGre: 24, tMax: 152 },
        '阿斯佩爾': { id: 76, s: ['PVP傷害增幅', 'PVP傷害抵抗', 'PVP傷害耐性'], b: ['異常狀態抵抗', '異常狀態擊中'], v: 2.5, tOra: 6, tBlu: 16, tGre: 24, tMax: 152 },
        '瑪爾庫坦': { id: 77, s: ['武器傷害增幅', '武器傷害耐性'], b: ['再生', '鐵壁', '再生貫穿', '鐵壁貫穿'], v: 2.5, tOra: 8, tBlu: 16, tGre: 24, tMax: 152 }
    };

    let rows = '', totalSum = 0;
    let sumMaxNodes = 0, sumOpened = 0, sumPotential = 0, sumMaxScore = 0;
    
    // 遍歷所有預定義的板塊名稱，確保順序固定且不漏抓
    Object.keys(boardConfigMap).forEach(bName => {
        const cfg = boardConfigMap[bName];
        const id = cfg.id; // 這是我們畫面上顯示的 ID 順序

        // 👑 寬鬆搜尋：優先找名稱匹配的數據 (解決不同職業 boardId 不同的問題)
        const deBoard = deBoardList.find(b => 
            (b.boardName && b.boardName.includes(bName)) ||
            (b.name && b.name.includes(bName)) ||
            (b.boardId == id || b.id == id)
        );
        const deDetailItem = deDetailsList.find(d => 
            (d.boardName && d.boardName.includes(bName)) ||
            (d.name && d.name.includes(bName)) ||
            (d.boardId == id || d.id == id)
        );
        
        const actualBoardId = (deDetailItem && (deDetailItem.boardId || deDetailItem.id)) || (deBoard && (deBoard.boardId || deBoard.id)) || id;
        const isSkillBoard = (actualBoardId % 10) <= 4;
        
        // 修正：技能板塊的總開啟數應為 屬性節點 + 技能節點
        let opened = 0;
        if (deBoard) {
            if (deBoard.openNodeCount !== undefined) {
                opened = deBoard.openNodeCount;
            } else {
                const statCount = deBoard.detail?.openStatEffectList?.length || 0;
                const skillCount = isSkillBoard ? (deBoard.detail?.openSkillEffectList?.length || 0) : 0;
                opened = statCount + skillCount;
            }
        }

        const maxNodes = cfg.tMax; 
        const tOra = cfg.tOra;
        const tBlu = cfg.tBlu;
        const tGre = cfg.tGre;
        const tWhi = maxNodes - tOra - tBlu - tGre;
        const maxScore = (tOra * 4) + (tBlu * 3) + (tGre * 2) + (tWhi * 1);
        sumMaxScore += maxScore;

        if (!deDetailItem || opened === 0) {
            // 預設一分在白色邏輯：當有開格數但沒明細時，分數 = 已開格數 + 橘藍加成。若開 0 格則 0 分。
            const isStatBoard = (actualBoardId % 10) >= 5;
            let score = opened;
            if (isStatBoard && opened > 0) score = (maxScore - tGre); 
            
            let scoreDisp = `${opened} / ${maxScore}`;
            if (isStatBoard && opened > 0) scoreDisp = `${score} (+${tGre}) / ${maxScore}`;
            if (opened >= maxNodes) { score = maxScore; scoreDisp = `${maxScore} / ${maxScore}`; }

            rows += `<tr class="esc-equip-row">
                <td>${actualBoardId}</td>
                <td style="color:var(--gold); font-weight:bold;">${bName}</td>
                <td style="text-align:center;">${maxNodes}</td>
                <td style="text-align:center; font-weight:bold; color:#fff;">${Math.min(opened, maxNodes)}</td>
                <td class="rarity-val-legend" style="text-align:center;">- / ${tOra}</td>
                <td class="rarity-val-unique" style="text-align:center;">- / ${tBlu}</td>
                <td class="rarity-val-rare" style="text-align:center;">- / ${tGre}</td>
                <td class="rarity-val-common" style="text-align:center;">${Math.min(opened, tWhi)} / ${tWhi}</td>
                <td style="text-align:right; color:#ffe66d; font-weight:bold; font-size:16px;">${scoreDisp}</td>
            </tr>`;
            totalSum += score;
            if (scoreDisp.includes('(+')) {
                sumPotential += tGre;
            }
            sumMaxNodes += maxNodes;
            sumOpened += Math.min(opened, maxNodes);
            return;
        }

        const d = deDetailItem.detail || deDetailItem;
        let ora = 0, blu = 0, gre = 0, whi = 0;

        // 1. 數值換算：橘色 (特殊屬性) 與 藍色屬性 (75-77 專屬)
        const oraStats = {};
        const bluStats = {};
        (d.openStatEffectList || []).forEach(s => {
            const dc = (s.desc || "").trim();
            const valMatch = dc.match(/([\d\.]+)/);
            if (!valMatch) return;
            const val = parseFloat(valMatch[1]);

            cfg.s.forEach(key => {
                if (dc.includes(key)) {
                    if (!oraStats[key] || val > oraStats[key]) oraStats[key] = val;
                }
            });
            if (cfg.b) {
                cfg.b.forEach(key => {
                    if (dc.includes(key)) {
                        if (!bluStats[key] || val > bluStats[key]) bluStats[key] = val;
                    }
                });
            }
        });
        // 換算點數：橘色依係數 v，藍色屬性直接 1:1
        Object.values(oraStats).forEach(v => ora += Math.round(v / cfg.v));
        Object.values(bluStats).forEach(v => blu += Math.round(v));
        
        ora = Math.min(ora, tOra);

        // --- 核心分流判定邏輯：1-4 為技能分頁，5-7 為屬性分頁 ---
        const bType = actualBoardId % 10;
        if (bType <= 4) {
            // 🛡️ 71-74 板塊：確保與「附加與收集系統」分頁的類別完全一致
            // 整合所有可能的 API 路徑
            const getSkillsFromData = (obj) => {
                if (!obj) return [];
                if (Array.isArray(obj)) return obj;
                if (obj.skillList && Array.isArray(obj.skillList)) return obj.skillList;
                if (obj.skills && Array.isArray(obj.skills)) return obj.skills;
                return [];
            };

            let allApiSkills = getSkillsFromData(data.skills) || getSkillsFromData(data.skill) || getSkillsFromData(json.skills) || [];
            if (allApiSkills.length === 0) {
                const deepSkills = deepSearch(json, 'skills') || deepSearch(json, 'skillList') || [];
                allApiSkills = Array.isArray(deepSkills) ? deepSkills : getSkillsFromData(deepSkills);
            }
            
            const skillDB = window.SKILL_NAMES_DB || {};
            
            (d.openSkillEffectList || []).forEach(sk => {
                const dc = (sk.desc || "").trim();
                const countMatch = dc.match(/(\d+)(?!.*\d)/);
                const count = countMatch ? parseInt(countMatch[1]) : 1;
                
                let nodeId = (sk.skillId || sk.id || "").toString();
                // 🔄 職業專屬反查：基於角色真實的板塊 ID 段 (例如守護 2x, 劍星 1x) 定位技能
                if (!nodeId) {
                    const bGroup = Math.floor(actualBoardId / 10);
                    const prefixMap = {
                        1: '11', 2: '12', 3: '14', 4: '13',
                        5: '16', 6: '15', 7: '17', 8: '18'
                    };
                    const pfx = prefixMap[bGroup];
                    const cleanName = dc.replace(/[\d\+\s]/g, '').trim();
                    
                    for (const sid in skillDB) {
                        if (pfx && !sid.startsWith(pfx)) continue;
                        if (skillDB[sid].replace(/\s/g, '') === cleanName) { nodeId = sid; break; }
                    }
                }

                const dbName = skillDB[nodeId] || "";

                // 1. ID 判定：Aion 官方規範板塊被動 ID 區段 (xx71 - xx80 100% 為綠色)
                let isPassive = false;
                if (nodeId.length >= 4) {
                    const sub = nodeId.substring(2, 4);
                    // 官方板塊專屬技能 (包含體力強化 71, 守護印章 75, 生存意志 79 等)
                    if (sub >= '71' && sub <= '80') isPassive = true;
                }

                // 2. 職業判定：比對該職業專屬的被動技能清單 (PASSIVE_SKILLS_DB)
                if (!isPassive && classPassives.size > 0) {
                    const nameToTest = (dbName || dc).replace(/[\d\+\s]/g, '').trim();
                    // 只要在職業被動庫中 (如: 體力強化, 銅牆鐵壁, 激昂)，即判定為綠色
                    if (classPassives.has(nameToTest)) isPassive = true;
                }

                // 3. API 判定：搜尋 API 原始數據中的官方分類
                if (!isPassive) {
                    const skillEntry = allApiSkills.find(s => {
                        if (nodeId && s.id && nodeId === s.id.toString()) return true;
                        const cleanSName = (s.name || "").replace(/\s/g, '');
                        const cleanTest = (dbName || dc).replace(/[\d\+\s]/g, '');
                        return cleanSName && cleanTest === cleanSName.replace(/[\d\+\s]/g, '');
                    });
                    if (skillEntry && skillEntry.category === "Passive") isPassive = true;
                }
                
                if (isPassive) gre += count; else blu += count;
            });
        } else {
            // ⚔️ 75-77 板塊：綠色來自「特化屬性 2 (cfg.b)」
            const secondaryStats = cfg.b || [];
            Object.keys(bluStats).forEach(sName => {
                if (secondaryStats.some(s => sName.includes(s))) {
                    gre += Math.round(bluStats[sName]);
                } else {
                    blu += Math.round(bluStats[sName]);
                }
            });
        }

        // 點數封頂與計算邏輯
        ora = Math.min(ora, tOra);
        blu = Math.min(blu, tBlu);
        gre = Math.min(gre, tGre);
        whi = Math.max(0, opened - ora - blu - gre);
        whi = Math.min(whi, tWhi);

        // 3. 計算結果
        let score = 0, scoreDisp = '', greDisp = '', whiDisp = '';
        const isStatBoard = (actualBoardId % 10) >= 5;

        if (isStatBoard) {
            if (opened >= maxNodes) {
                ora = tOra; blu = tBlu; gre = tGre; whi = tWhi;
                scoreDisp = `${maxScore} / ${maxScore}`;
                greDisp = `${tGre} / ${tGre}`;
                whiDisp = `${tWhi} / ${tWhi}`;
            } else {
                // 點數權重：橘4 藍3 綠2 白1
                const currentScore = (ora * 4) + (blu * 3) + (whi * 1) + (maxNodes - opened); 
                score = currentScore;
                scoreDisp = `${currentScore} (+${tGre}) / ${maxScore}`;
                greDisp = `- / ${tGre}`;
                whiDisp = `${whi} / ${tWhi}`;
            }
        } else {
            score = (ora * 4) + (blu * 3) + (gre * 2) + (whi * 1);
            scoreDisp = `${score} / ${maxScore}`;
            greDisp = `${gre} / ${tGre}`;
            whiDisp = `${whi} / ${tWhi}`;
        }

        totalSum += score;
        if (scoreDisp.includes('(+')) {
            const m = scoreDisp.match(/\(\+(\d+)\)/);
            if (m) sumPotential += parseInt(m[1]);
        }
        sumMaxNodes += maxNodes;
        sumOpened += Math.min(opened, maxNodes);

        rows += `<tr class="esc-equip-row">
            <td>${actualBoardId}</td>
            <td style="color:var(--gold); font-weight:bold;">${bName}</td>
            <td style="text-align:center;">${maxNodes}</td>
            <td style="text-align:center; font-weight:bold; color:#fff;">${Math.min(opened, maxNodes)}</td>
            <td class="rarity-val-legend" style="text-align:center;">${ora} / ${tOra}</td>
            <td class="rarity-val-unique" style="text-align:center;">${blu} / ${tBlu}</td>
            <td class="rarity-val-rare" style="text-align:center;">${greDisp}</td>
            <td class="rarity-val-common" style="text-align:center;">${whiDisp}</td>
            <td style="text-align:right; color:#ffe66d; font-weight:bold; font-size:16px;">${scoreDisp}</td>
        </tr>`;
    });

    // 🏆 合計橫列：總上限修正為 1248
    rows += `<tr style="background:rgba(255,255,255,0.05); font-weight:bold; border-top:1px solid rgba(255,255,255,0.1);">
        <td colspan="2" style="text-align:center; color:#adb5bd;">合計小計</td>
        <td style="text-align:center;">${sumMaxNodes}</td>
        <td style="text-align:center; color:#fff;">${sumOpened}</td>
        <td colspan="4"></td>
        <td style="text-align:right; color:#ffe66d; font-size:18px;">${totalSum}${sumPotential > 0 ? ' (+' + sumPotential + ')' : ''} / ${sumMaxScore}</td>
    </tr>`;

    container.innerHTML = `<table class="esc-equip-table"><thead><tr><th>ID</th><th>板塊</th><th>總格</th><th>獲取</th><th class="rarity-val-legend">橘 (特殊)</th><th class="rarity-val-unique">藍 (主動)</th><th class="rarity-val-rare">綠 (被動)</th><th class="rarity-val-common">白 (普通)</th><th style="text-align:right;">評分</th></tr></thead><tbody>${rows}</tbody></table>`;
    return { total: totalSum, potential: sumPotential };
}

/**
 * 👑 主渲染函數
 */
async function renderEquipSourceGrid(json) {
    const block = document.getElementById('equip-source-block');
    const statsPanel = document.getElementById('equip-source-stats-panel');
    const equipContent = document.getElementById('esc-equip-content');

    if (!block || !statsPanel || !equipContent) return;

    function findDataByKey(obj, key) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj[key] !== undefined) return obj[key];
        for (const k in obj) {
            const found = findDataByKey(obj[k], key);
            if (found) return found;
        }
        return null;
    }

    block.style.display = 'block';

    const data = json.queryResult ? json.queryResult.data : (json.data ? json.data : json);
    const itemsToProcess = findDataByKey(data, 'itemDetails') || [];
    const equipmentList = findDataByKey(data, 'equipmentList') || [];
    const equipMap = {};
    equipmentList.forEach(item => { equipMap[item.slotPos] = item; });

    const seenSlots = new Set();
    const uniqueItems = itemsToProcess.filter(i => {
        if (seenSlots.has(i.slotPos)) return false;
        seenSlots.add(i.slotPos); return true;
    });

    const itemScores = [];
    uniqueItems.forEach(item => {
        const res = calcItemDetailScore(item, equipMap);
        if (res) itemScores.push(res);
    });

    let L = 0, B = 0, G = 0, M = 0;
    itemScores.forEach(s => { L += s.levelScore; B += s.breakthroughScore; G += s.godStoneScore; M += s.magicStoneScore; });

    const equipTotal = Math.round((L + B + G + M) * 10) / 10;
    const boardRes = await loadDaevanionScoreDetails(json);
    const boardTotal = Math.round(boardRes.total * 10) / 10;
    const boardPot = boardRes.potential || 0;
    const grandTotal = Math.round((equipTotal + boardTotal) * 10) / 10;

    // 左側統計
    let statHtml = '<div style="font-size:12px; color:#8b949e; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; margin-bottom:10px;">📊 評分統計</div>';
    function row(l, v, c, s) {
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:${s ? '2px' : '6px'} 0; font-size:${s ? '11px' : '13px'};">
            <span style="color:${s ? '#6b7a90' : '#cbd5e1'};">${l}</span>
            <span style="color:${c}; font-weight:bold;">${v}</span>
        </div>`;
    }
    statHtml += row('⚔️ 裝備評分', equipTotal, '#f1c40f', false);
    statHtml += row('　品階等級', L, '#adb5bd', true);
    statHtml += row('　突破加成', B, '#ff7b7b', true);
    statHtml += row('　神石加成', G, '#f39c12', true);
    statHtml += row('　磨石加成', M, '#3498db', true);
    statHtml += '<div style="height:1px; background:rgba(255,255,255,0.06); margin:8px 0;"></div>';
    
    // 🛡️ 守護力評分顯示同步 (+N)
    const boardValueDisp = boardPot > 0 ? `${boardTotal} <span style="font-size:11px; opacity:0.8;">(+${boardPot})</span>` : boardTotal;
    statHtml += row('🛡️ 守護力評分', boardValueDisp, '#00d4ff', false);

    statHtml += `<div style="margin-top:14px; padding:15px; background:rgba(255,215,0,0.05); border:1px solid rgba(255,215,0,0.2); border-radius:12px; text-align:center;">
        <div style="font-size:11px; color:#adb5bd;">🏆 總裝備分</div>
        <div style="font-size:32px; font-weight:900; color:#ffe66d;">${grandTotal}${boardPot > 0 ? `<span style="font-size:16px; opacity:0.7;">(+${boardPot})</span>` : ''}</div>
    </div>`;
    statsPanel.innerHTML = statHtml;

    // 右側列表
    if (itemScores.length === 0) {
        equipContent.innerHTML = '<div style="color:#666; text-align:center; padding:50px;">尚無裝備資料</div>';
    } else {
        const slotOrder = [1, 2, 3, 4, 5, 6, 7, 8, 19, 9, 10, 11, 12, 13, 14, 15, 16, 41, 42, 43, 44, 45, 46];
        itemScores.sort((a, b) => {
            let idxA = slotOrder.indexOf(a.slot);
            let idxB = slotOrder.indexOf(b.slot);
            if (idxA === -1) idxA = 99; if (idxB === -1) idxB = 99;
            return idxA - idxB;
        });

        let t = '<table class="esc-equip-table"><thead><tr>'
            + '<th style="text-align:left; width:60px;">部位</th>'
            + '<th style="text-align:left;">名稱 / 等級</th>'
            + '<th>強化</th><th>突破</th><th>磨/神石</th>'
            + '<th style="text-align:right;">評分</th>'
            + '</tr></thead><tbody>';

        itemScores.forEach(s => {
            t += `<tr class="esc-equip-row">
                <td style="color:#8b949e; font-size:11px;">${s.slotName}</td>
                <td style="text-align:left;">
                    <div style="color:${s.color}; font-weight:700;">${s.name}</div>
                    <div style="font-size:11px; color:#6b7a90;">Lv.${s.level} (${s.levelScore})</div>
                </td>
                <td style="text-align:center; font-weight:bold; color:#4cd137;">${s.enchantLevel > 0 ? '+' + s.enchantLevel : '-'}</td>
                <td style="text-align:center; color:#ff7b7b; font-weight:bold;">${s.exceedLevel > 0 ? '★' + s.exceedLevel : '-'}</td>
                <td style="text-align:center;">
                    <div style="font-size:11px; color:#3498db;">${s.magicStoneScore > 0 ? '🔹' + s.magicStoneScore : ''}</div>
                    <div style="font-size:11px; color:#f39c12;">${s.godStoneScore > 0 ? '🔸' + s.godStoneScore : ''}</div>
                </td>
                <td style="text-align:right; font-weight:bold; color:#fff;">${s.total}</td>
            </tr>`;
        });
        t += '</tbody></table>';
        equipContent.innerHTML = t;
    }
}
