function renderHealthCheck(data, stats) {
    const container = document.getElementById('health-check-card');
    if (!container) return;
    container.style.display = 'block';

    // 1. 計算數據
    let totalScore = 60; // 基礎分
    let adviceList = [];

    // 裝備強化分析
    let totalEnchant = 0;
    let enchantCount = 0;
    let lowEnchantItems = [];

    const items = (data.equipment ? data.equipment.equipmentList : []) || [];
    items.forEach(item => {
        const enchant = item.enchantLevel || 0;
        // 排除不強化或特殊的部位 (如翅膀、羽毛等如果是獨立計算)
        // 假設主要部位為 1-8 (防具武器)
        if (item.slotPos >= 1 && item.slotPos <= 8) {
            totalEnchant += enchant;
            enchantCount++;
            if (enchant < 10) lowEnchantItems.push(`${item.name} (+${enchant})`);
        }
    });

    const avgEnchant = enchantCount > 0 ? (totalEnchant / enchantCount) : 0;

    // 分數計算：平均強化
    // 假設平均+15為滿分標準(加30分)，每+1加2分
    totalScore += Math.min(40, avgEnchant * 2.5);

    // 建議：強化
    if (lowEnchantItems.length > 0) {
        adviceList.push({ type: 'warning', text: `發現 ${lowEnchantItems.length} 件主要裝備強化低於 +10，建議優先提升。` });
    } else if (avgEnchant >= 15) {
        adviceList.push({ type: 'good', text: `全身主要裝備平均強化 +${avgEnchant.toFixed(1)}，相當優秀！` });
    }

    // 套裝分析
    // 檢查是否有啟動的套裝
    let activeSets = 0;
    let maxSetBonus = 0;
    const setCountMap = new Map();
    (data.itemDetails || []).forEach(i => {
        const d = i.detail;
        if (d && d.set) {
            const setName = d.set.name;
            if (!setCountMap.has(setName)) {
                setCountMap.set(setName, { count: 0, bonuses: d.set.bonuses });
            }
            setCountMap.get(setName).count++;
        }
    });

    setCountMap.forEach((v, k) => {
        // 檢查是否觸發了最高級效果 (假設最後一個是最強效果)
        const maxDegree = v.bonuses[v.bonuses.length - 1].degree;
        if (v.count >= maxDegree) {
            activeSets++;
            totalScore += 10; // 完整套裝加10分
            adviceList.push({ type: 'good', text: `已完整觸發「${k}」套裝效果。` });
        } else if (v.count >= 2) {
            adviceList.push({ type: 'warning', text: `「${k}」套裝目前 ${v.count}/${maxDegree} 件，建議補齊。` });
            totalScore += 5;
        }
    });

    if (activeSets === 0 && setCountMap.size === 0) {
        adviceList.push({ type: 'critical', text: `未穿戴任何套裝裝備，建議獲取套裝以獲得額外加成。` });
        totalScore -= 10;
    }

    // 戰鬥力估算 (攻擊/增幅/暴擊)
    // 簡單判斷職業類型 (這裡只能概略猜測)
    const pAtk = stats['攻擊力'] ? stats['攻擊力'].final : 0;
    const mBoost = stats['魔法增幅力'] ? stats['魔法增幅力'].final : 0;
    const isMagic = mBoost > pAtk; // 簡單判定

    const mainStatName = isMagic ? '魔法增幅力' : '攻擊力';
    const mainStatVal = isMagic ? mBoost : pAtk;

    // 假設一個標準線 (這很主觀，僅供參考)
    const stdVal = isMagic ? 3000 : 800;
    if (mainStatVal > stdVal * 1.5) {
        totalScore += 10;
        adviceList.push({ type: 'good', text: `${mainStatName} 數值優異 (${mainStatVal})。` });
    } else if (mainStatVal < stdVal) {
        adviceList.push({ type: 'warning', text: `${mainStatName} 偏低，建議檢查魔石或強化。` });
    }

    // 限制分數 0-100
    totalScore = Math.min(100, Math.max(0, Math.round(totalScore)));

    // 評級
    let grade = 'C';
    let gradeColor = '#8b949e';
    if (totalScore >= 95) { grade = 'SSS'; gradeColor = '#ff0055'; }
    else if (totalScore >= 90) { grade = 'S'; gradeColor = '#ff4757'; }
    else if (totalScore >= 80) { grade = 'A'; gradeColor = '#ffa502'; }
    else if (totalScore >= 70) { grade = 'B'; gradeColor = '#2ed573'; }

    // 生成 HTML
    let adviceHtml = adviceList.map(a => `<div class="advice-item ${a.type}">${a.type === 'good' ? '✅' : (a.type === 'critical' ? '❌' : '⚠️')} ${a.text}</div>`).join('');

    // 亮點屬性 (取最高的三個屬性，排除HP/MP)
    const ignoreStats = ['生命力', '精神力', '神聖力'];
    let sortedStats = Object.keys(stats).filter(k => !ignoreStats.includes(k) && stats[k].final > 0).sort((a, b) => stats[b].final - stats[a].final).slice(0, 3);
    let highlightHtml = sortedStats.map(k => `<div class="stat-highlight-row"><span>${k}</span><span style="color:#fff;">${stats[k].final}</span></div>`).join('');

    container.innerHTML = `
                <div style="font-size: 16px; font-weight: bold; color: var(--gold); margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                    📋 機體健檢報告 <span style="font-size: 12px; color: #8b949e; font-weight: normal;">(Beta)</span>
                </div>
                <div class="health-check-container">
                    <div class="health-score-box">
                        <div class="health-score-val" style="background: ${totalScore >= 90 ? 'linear-gradient(to bottom, #fff, #ff4757)' : ''}">${grade}</div>
                        <div class="health-score-label">機體評級 (${totalScore}分)</div>
                        <div style="width: 100%; margin-top: 15px;">
                            ${highlightHtml}
                        </div>
                    </div>
                    <div class="health-details-box">
                        ${adviceHtml || '<div class="advice-item good">✅ 目前配置相當平衡，暫無重大建議。</div>'}
                    </div>
                </div>
            `;
}
