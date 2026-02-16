/**
 * Aion 2 技能資料庫 API 整合 - 閃電快取 + 視覺修復版
 * 保留 API 原生顏色，並透過 localStorage 加速
 */

const SKILL_API_BASE = 'https://questlog.gg/aion-2/api/trpc/database.getSkill';
const CACHE_PREFIX = 'aion_skill_';
const CACHE_EXPIRE = 86400000 * 7;

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

    try {
        const input = encodeURIComponent(JSON.stringify({ id: skillId.toString(), language: 'zh' }));
        const targetUrl = `${SKILL_API_BASE}?input=${input}`;

        const proxies = [
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

        if (!response || !response.ok) throw lastError;

        const data = await response.json();
        let skillData = data.result?.data?.json || data.result?.data || data.data;
        if (!skillData) return null;

        let levelData = skillData.levels?.find(l => l.level === level);
        if (!levelData && skillData.levels?.length > 0) {
            const sorted = [...skillData.levels].sort((a, b) => b.level - a.level);
            levelData = sorted.find(l => l.level <= level) || sorted[sorted.length - 1];
        }

        let description = levelData?.description || skillData.description || '';

        // 如果原始描述太短，才找 descriptionData
        if ((!description || description.length < 5) && levelData?.descriptionData?.text) {
            description = levelData.descriptionData.text;
        }

        if (description) {
            // 1. 去除引擎雜訊字 (FALSE, DeBuff...)
            const noise = ['FALSE', 'DeBuff', 'Vacant', 'SkillUI', 'Sum', 'Min', 'Max', 'Dmg'];
            noise.forEach(word => description = description.replace(new RegExp(word, 'gi'), ''));

            // 2. 數值填充
            if (levelData) {
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
                .replace(/\{[^}]+\}/g, '') // 清理 {變數}
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
    } catch (error) {
        return null;
    }
}

function formatSkillEffects(skillInfo) {
    if (!skillInfo) return `<span style="color:#8b949e; font-size:11px;">⏳ 載入中...</span>`;
    let html = '';

    // 技巧：如果描述裡沒有 HTML 標籤，我們自動幫數字上色，增加易讀性
    let desc = skillInfo.description;
    if (desc && !desc.includes('<span')) {
        desc = desc.replace(/(\d+%?)/g, '<span style="color:#FCC78B">$1</span>');
    }

    if (desc) html += `<span style="color:var(--green);">▹ ${desc}</span><br>`;

    if (skillInfo.effects && Array.isArray(skillInfo.effects)) {
        skillInfo.effects.forEach(eff => {
            if (eff?.trim()) {
                // 也幫效果裡的數字上色
                let e = eff.replace(/(\d+%?)/g, '<span style="color:#FCC78B">$1</span>');
                html += `<span style="color:var(--green);">▹ ${e}</span><br>`;
            }
        });
    }
    return html || `<span style="color:#8b949e; font-size:11px;">💡 數據尚未收錄</span>`;
}

window.SkillAPI = {
    fetchSkill: fetchSkillFromAPI,
    formatEffects: formatSkillEffects,
    clearCache: () => FastCache.clearOld()
};
