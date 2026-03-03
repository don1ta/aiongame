/**
 * Aion2 技能 API 整合模組 (skill-api.js)
 * 
 * 此檔案提供了與 QuestLog 技能數據庫互動的進階介面，主要負責：
 * 1. 遠端數據抓取：根據技能 ID 與等級，異步獲取詳細的技能描述與效果。
 * 2. 說明文字解析：解析 API 回傳的模板標籤（如 {abe:xxx}），將其轉換為正確的屬性數值。
 * 3. 視覺格式化：保留 API 原生的 HTML 顏色標籤（如被動技能金字），並提供格式化輸出的功能。
 * 4. 高效能快取：利用 localStorage 管理技能數據，大幅縮短重複查看技能時的載入延遲。
 */

const SKILL_API_BASE = 'https://questlog.gg/aion-2/api/trpc/database.getSkill';
const CACHE_PREFIX = 'aion_skill_v16_'; // 強制刷新快取代 v7 (全面數值偵測版)
const CACHE_EXPIRE = 0; // 改回 0 模式，確保每次重整皆重新解析 API 數值

// 處理 descriptionData 模板變數解析 (移至頂部確保可用)
function processDescriptionData(dd, targetLevel) {
    if (!dd || !dd.text) return '';
    let text = dd.text;

    // 取得變數集合
    let variables = dd.placeholders || dd.variables || dd;

    // 1. 清理所有舊標籤，回歸最純淨的敘述文字
    text = text.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '');

    // 2. 解析並替換變數 (此時先不加顏色，等最後統一處理)
    for (let key in variables) {
        if (key === 'text' || key === 'placeholders' || key === 'variables') continue;
        let varData = variables[key];
        let val = null;

        if (varData.levels && varData.levels[targetLevel]) {
            val = varData.levels[targetLevel].values;
        } else if (varData.levels) {
            let levels = Object.keys(varData.levels).map(Number).sort((a, b) => b - a);
            let matchLv = levels.find(l => l <= targetLevel) || levels[levels.length - 1];
            if (matchLv) val = varData.levels[matchLv].values;
        }

        if (!val && varData.base) val = varData.base.values;

        if (val && Array.isArray(val)) {
            let numVal = val[1];
            if (varData.modifier === 'divide100') numVal = (parseFloat(numVal) / 100).toString();
            else if (varData.modifier === 'time') numVal = (parseFloat(numVal) / 1000).toString() + 's';

            if (key.includes('se_') || key.includes('SkillUI')) {
                if (varData.property && varData.property.includes('Min')) numVal = val[0];
                if (varData.property && varData.property.includes('Max')) numVal = val[1] || val[0];
            }
            if (numVal !== null) text = text.split(key).join(numVal);
        }
    }

    // 3. 終極數值偵測：找出句子中所有的數字、範圍 ~、百分比 %，並統一染成金色
    // 正則解釋：數字(含小數) 可能接著 ~數字，最後可能帶 %
    const numRegex = /(\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?%?)/g;
    text = text.replace(numRegex, '<span class="api-num-highlight" style="color:#FCC78B !important; font-weight:bold; font-family:\'Segoe UI\', sans-serif;">$1</span>');

    return text;
}

// 檢查可用性
function isQuotaExceeded(e) {
    return e instanceof DOMException && (
        e.code === 22 || e.code === 1014 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
}

const FastCache = {
    get(id, level) {
        try {
            const key = `${CACHE_PREFIX}${id}_${level}`;
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() - parsed.timestamp > CACHE_EXPIRE) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) { return null; }
    },
    set(id, level, data) {
        try {
            const key = `${CACHE_PREFIX}${id}_${level}`;
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {
            if (isQuotaExceeded(e)) {
                this.clearOld(); // 清理舊資料後重試
                try { localStorage.setItem(`${CACHE_PREFIX}${id}_${level}`, JSON.stringify({ timestamp: Date.now(), data })); } catch (ignore) { }
            }
        }
    },
    clearOld() {
        // 簡單策略：清除所有相關快取
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        });
    }
};

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function fetchSkillFromAPI(skillId, level) {
    const cached = FastCache.get(skillId, level);
    if (cached) return cached;

    let skillData = null;

    // 1. 優先檢查靜態載入的資料 (window.SKILL_DATA_STATIC)
    if (window.SKILL_DATA_STATIC && window.SKILL_DATA_STATIC[skillId]) {
        skillData = window.SKILL_DATA_STATIC[skillId];
    } else {
        // 2. 網路請求邏輯
        try {
            const input = encodeURIComponent(JSON.stringify({ id: skillId.toString(), language: 'zh' }));
            const targetUrl = `${SKILL_API_BASE}?input=${input}`;

            const proxies = [
                `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(targetUrl)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
                `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
            ];

            let response = null;
            let lastError = null;

            for (let proxy of proxies) {
                try {
                    response = await fetchWithTimeout(proxy, { timeout: 5000 });
                    if (response.ok) break;
                } catch (e) { lastError = e; }
            }

            if (response && response.ok) {
                const data = await response.json();
                skillData = data.result?.data?.json || data.result?.data || data.data;
            }
        } catch (e) {
            console.warn(`[SkillAPI] 請求失敗 ID:${skillId}`, e);
        }
    }

    if (!skillData) return null;

    let levelData = skillData.levels?.find(l => l.level === level);
    if (!levelData && skillData.levels?.length > 0) {
        const sorted = [...skillData.levels].sort((a, b) => b.level - a.level);
        levelData = sorted.find(l => l.level <= level) || sorted[sorted.length - 1];
    }

    let description = '';

    // 處理 descriptionData (優先於純文字描述)
    // 這是解決高等級技能數值顯示錯誤（如 Lv16 顯示 Lv1 數值）的關鍵
    if (skillData.descriptionData && skillData.descriptionData.text) {
        description = processDescriptionData(skillData.descriptionData, level);
    } else {
        // 舊邏輯 fallback
        description = levelData?.description || skillData.description || '';
        // 如果原始描述太短，才找 levels 中的 descriptionData (有些舊 API 結構)
        if ((!description || description.length < 5) && levelData?.descriptionData?.text) {
            description = levelData.descriptionData.text;
        }
    }

    if (description) {
        // 1. 去除引擎雜訊字 (FALSE, DeBuff...)
        const noise = ['FALSE', 'DeBuff', 'Vacant', 'SkillUI', 'Sum', 'Min', 'Max', 'Dmg'];
        noise.forEach(word => description = description.replace(new RegExp(word, 'gi'), ''));

        // 2. 數值填充 (僅當 descriptionData 未處理時使用舊邏輯)
        if (!skillData.descriptionData && levelData) {
            const clean = (v) => (v && v.length < 8 && v !== '0') ? v : null;
            const val1 = clean(levelData.minValue), val2 = clean(levelData.maxValue),
                val3 = clean(levelData.minValue2), val4 = clean(levelData.maxValue2);
            let finalVal = val3 ? (val4 && val4 !== val3 ? `${val3}~${val4}` : val3)
                : (val1 ? (val2 && val2 !== val1 ? `${val1}~${val2}` : val1) : '');

            // 使用官方金色樣式填充
            if (finalVal) {
                description = description.replace(/~+/g, `<span style="color: #FCC78B">${finalVal}</span>`);
            }
        }

        // 3. 最終清理 (修正點：保留 span 和 br 標籤，只移除 se_ 等垃圾標籤)
        description = description
            .replace(/\{[^}]+\}/g, '') // 清理未解析的 {變數}
            .replace(/<(se_|SkillUI)[^>]+>/g, '') // 只清理特定垃圾標籤 <se_...>
            .replace(/<(?!\/?(span|br|b|strong))[^>]+>/gi, '') // 移除除了 span, br, b 以外的標籤 (更安全)
            .replace(/\d+!\d+!\d+/g, '')
            .replace(/\d{9,}/g, '')
            .replace(/[a-zA-Z]+(?=\d)/g, '')
            .replace(/(?<=\d)[a-zA-Z]+/g, '')
            .replace(/、+/g, '、')
            .replace(/、\s*$/g, '')
            .trim();
    }

    const result = {
        id: skillId, name: skillData.name || '未知', level: level,
        description: description, effects: levelData?.effects || [],
        icon: skillData.icon || ''
    };

    FastCache.set(skillId, level, result);
    return result;
}

function formatSkillEffects(skillInfo) {
    if (!skillInfo) return `<span style="color:rgba(255,255,255,0.75); font-size:11px;">⏳ 載入中...</span>`;
    let html = '';

    // 技巧：如果描述裡沒有 HTML 標籤，我們自動幫數字上色，增加易讀性
    let desc = skillInfo.description;
    if (desc && !desc.includes('<span')) {
        desc = desc.replace(/(\d+%?)/g, '<span style="color:#FCC78B">$1</span>');
    }

    if (desc) html += `<span style="color:rgba(255,255,255,0.75);">${desc}</span><br>`;

    if (skillInfo.effects && Array.isArray(skillInfo.effects)) {
        skillInfo.effects.forEach(eff => {
            if (eff?.trim()) {
                // 也幫效果裡的數字上色
                let e = eff.replace(/(\d+%?)/g, '<span style="color:#FCC78B">$1</span>');
                html += `<span style="color:rgba(255,255,255,0.75);">${e}</span><br>`;
            }
        });
    }
    return html || `<span style="color:rgba(255,255,255,0.75); font-size:11px;">💡 數據尚未收錄</span>`;
}

window.SkillAPI = {
    fetchSkill: fetchSkillFromAPI,
    formatEffects: formatSkillEffects,
    clearCache: () => FastCache.clearOld()
};
