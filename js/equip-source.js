/**
 * Aion2 裝備來源評分明細系統 (equip-source.js)
 * 
 * 提供裝備評分明細區塊的渲染邏輯：
 * - 分頁1：裝備等級 - 顯示每件裝備的名稱/強化/突破/神石/磨石明細與分數
 * - 分頁2：守護力獲取 - 顯示各板塊進度與得分
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
    let cardBonus = 0;

    if (isArcana) {
        // 聖杯卡片：分數 = 品階分 (不再另外加算等級分，避免 80+80=160)
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
        rarityInfo: typeof getEquipmentRarityInfo === 'function' ? getEquipmentRarityInfo(item) : null,
        levelScore: baseScore,         // 這裡存放經判斷後的基礎分
        enchantScore: enchantScore,
        breakthroughScore: breakthroughScore,
        godStoneScore: godStoneScore,
        magicStoneScore: magicStoneScore,
        cardScore: 0,                  // 已整合進 baseScore
        total: total,
        godStoneDetails: godStoneDetails,
        magicStoneDetails: magicStoneDetails,
        isArcana: isArcana,
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
async function loadDaevanionScoreDetails(rawData) {
    const boardIds = [71, 72, 73, 74, 75, 76, 77];
    const container = document.getElementById('esc-board-content');
    if (!container) return { total: 0 };

    function findDataByKey(obj, key) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj[key] !== undefined) return obj[key];
        for (const k in obj) {
            const found = findDataByKey(obj[k], key);
            if (found) return found;
        }
        return null;
    }

    const deBoardList = findDataByKey(rawData, 'daevanionBoardList') || [];
    const deDetailsList = findDataByKey(rawData, 'daevanionDetails') || [];

    const boardConfig = {
        71: { name: '奈薩肯', s: ['戰鬥速度', '冷卻時間減少'], v: 2.5 },
        72: { name: '吉凱爾', s: ['傷害耐性', '傷害增幅'], v: 5 },
        73: { name: '白傑爾', s: ['暴擊傷害增幅', '暴擊傷害耐性'], v: 5 },
        74: { name: '崔妮爾', s: ['多段打擊抵抗', '多段打擊擊中'], v: 3 },
        75: { name: '艾瑞爾', s: ['PVE傷害增幅', 'PVE傷害抵抗'], v: 2.5 },
        76: { name: '阿斯佩爾', s: ['PVP傷害增幅', 'PVP傷害抵抗'], v: 2.5 },
        77: { name: '瑪爾庫坦', s: ['武器傷害增幅', '武器傷害耐性'], v: 2.5 }
    };

    let rows = '', totalSum = 0;
    boardIds.forEach(id => {
        const cfg = boardConfig[id];
        const deBoard = deBoardList.find(b => b.id == id);
        const deDetailItem = deDetailsList.find(d => d.boardId == id || d.board_id == id);
        const max = deBoard ? deBoard.totalNodeCount : 88;
        const opened = deBoard ? deBoard.openNodeCount : 0;

        if (!deDetailItem || opened === 0) {
            rows += `<tr class="esc-equip-row"><td>${id}</td><td>${cfg.name}</td><td style="text-align:center;">${max}</td><td style="text-align:center;">0</td><td colspan="4" style="text-align:center; color:#444;">未開通</td><td style="text-align:right; color:#444;">0</td></tr>`;
            return;
        }

        const d = deDetailItem.detail || deDetailItem;
        let ora = 1, blu = 0, gre = 0, whi = 0;
        (d.openStatEffectList || []).forEach(s => {
            const dc = (s.desc || "").trim();
            if (cfg.s.some(k => dc.includes(k))) {
                const m = dc.match(/([\d\.]+)/);
                if (m) ora += Math.round(parseFloat(m[1]) / cfg.v);
            } else whi++;
        });
        (d.openSkillEffectList || []).forEach(sk => {
            const dc = (sk.desc || "").trim();
            if (dc.includes('被動') || dc.includes('加護')) gre++; else blu++;
        });

        const score = (ora + blu + gre + whi) + (ora * 3) + (blu * 2) + (gre * 1);
        totalSum += score;

        rows += `<tr class="esc-equip-row">
            <td>${id}</td><td style="color:var(--gold); font-weight:bold;">${cfg.name}</td>
            <td style="text-align:center;">${max}</td><td style="text-align:center; font-weight:bold; color:#fff;">${ora + blu + gre + whi}</td>
            <td class="rarity-val-legend" style="text-align:center;">${ora}</td>
            <td class="rarity-val-unique" style="text-align:center;">${blu}</td>
            <td class="rarity-val-rare" style="text-align:center;">${gre}</td>
            <td class="rarity-val-common" style="text-align:center;">${whi}</td>
            <td style="text-align:right; color:#ffe66d; font-weight:bold; font-size:16px;">${score}</td>
        </tr>`;
    });

    container.innerHTML = `<table class="esc-equip-table"><thead><tr><th>ID</th><th>板塊</th><th>總格</th><th>獲取</th><th class="rarity-val-legend">橘</th><th class="rarity-val-unique">藍</th><th class="rarity-val-rare">綠</th><th class="rarity-val-common">白</th><th style="text-align:right;">評分</th></tr></thead><tbody>${rows}</tbody></table>`;
    return { total: totalSum };
}

/**
 * 👑 主渲染函數
 */
async function renderEquipSourceGrid(data) {
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

    let L = 0, B = 0, G = 0, M = 0, C = 0;
    itemScores.forEach(s => { L += s.levelScore; B += s.breakthroughScore; G += s.godStoneScore; M += s.magicStoneScore; C += s.cardScore; });

    const equipTotal = Math.round((L + B + G + M + C) * 10) / 10;
    const boardRes = await loadDaevanionScoreDetails(data);
    const boardTotal = Math.round(boardRes.total * 10) / 10;
    const grandTotal = Math.round((equipTotal + boardTotal) * 10) / 10;

    // 左側面板
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
    if (C > 0) statHtml += row('　卡片加成', C, '#9b59b6', true);
    statHtml += '<div style="height:1px; background:rgba(255,255,255,0.06); margin:8px 0;"></div>';
    statHtml += row('🛡️ 守護力評分', boardTotal, '#00d4ff', false);
    statHtml += `<div style="margin-top:14px; padding:15px; background:rgba(255,215,0,0.05); border:1px solid rgba(255,215,0,0.2); border-radius:12px; text-align:center;">
        <div style="font-size:11px; color:#adb5bd;">🏆 總裝備分</div>
        <div style="font-size:32px; font-weight:900; color:#ffe66d;">${grandTotal}</div>
    </div>`;
    statsPanel.innerHTML = statHtml;

    // 右側表格 (分頁1)
    if (itemScores.length === 0) {
        equipContent.innerHTML = '<div style="color:#666; text-align:center; padding:50px;">尚無裝備資料 (請確認查詢)</div>';
    } else {
        // 依照常用部位順序排序 (1-16 + 19/披風 + 聖杯)
        const slotOrder = [1, 2, 3, 4, 5, 6, 7, 8, 19, 9, 10, 11, 12, 13, 14, 15, 16, 41, 42, 43, 44, 45, 46];
        itemScores.sort((a, b) => {
            let idxA = slotOrder.indexOf(a.slot);
            let idxB = slotOrder.indexOf(b.slot);
            if (idxA === -1) idxA = 99;
            if (idxB === -1) idxB = 99;
            return idxA - idxB;
        });

        let t = '<table class="esc-equip-table"><thead><tr>'
            + '<th style="text-align:left; width:60px;">部位</th>'
            + '<th style="text-align:left;">名稱 / 等級</th>'
            + '<th>強化</th>'
            + '<th>突破</th>'
            + '<th>神石</th>'
            + '<th>磨石</th>'
            + '<th style="text-align:right;">小計</th>'
            + '</tr></thead><tbody>';

        itemScores.forEach(s => {
            const rc = s.rarityInfo ? s.rarityInfo.color : '#888';
            const gs = s.godStoneDetails.map(g => `<div style="color:${getEscGradeColor(g.grade)};font-size:11px;">+${g.score}</div>`).join('') || '—';
            const ms = s.magicStoneDetails.map(m => `<span style="color:${getEscGradeColor(m.grade)};font-size:11px;margin-right:3px;">+${m.score}</span>`).join('') || '—';

            t += `<tr class="esc-equip-row">
                <td style="text-align:left; color:#8b949e; font-size:13px;">${s.slotName}</td>
                <td style="text-align:left;">
                    <div style="color:${rc}; font-weight:bold; font-size:13px; white-space:nowrap;">
                        ${s.name} Lv.${s.level}
                    </div>
                </td>
                <td style="text-align:center; color:#64b3f4; font-weight:bold;">${s.enchantLevel ? '+' + s.enchantLevel : '—'}</td>
                <td style="text-align:center; color:#ff7b7b; font-weight:bold;">${s.exceedLevel ? '+' + s.exceedLevel + ' (+' + s.breakthroughScore + ')' : '—'}</td>
                <td style="text-align:center;">${gs}</td>
                <td style="text-align:center;">${ms}</td>
                <td style="text-align:right; color:#ffe66d; font-weight:bold; font-size:15px;">${s.total}</td>
            </tr>`;
        });
        t += `<tr style="background:rgba(0,0,0,0.2);"><td colspan="6" style="text-align:right; color:#adb5bd; font-weight:bold; padding:15px;">裝備合計總分</td><td style="text-align:right; color:#ffe66d; font-weight:900; font-size:20px;">${equipTotal}</td></tr></tbody></table>`;
        equipContent.innerHTML = t;
    }
}
