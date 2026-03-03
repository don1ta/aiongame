
(async function () {
    console.log("🚀 開始抓取全量技能數據 (包含等級模板)...");

    const db = window.PASSIVE_SKILLS_DB;
    const names = window.SKILL_NAMES_DB;
    if (!db || !names) {
        console.error("❌ 找不到 PASSIVE_SKILLS_DB 或 SKILL_NAMES_DB");
        return;
    }

    const skillMap = {};
    for (const [id, name] of Object.entries(names)) {
        skillMap[name] = id;
    }

    const targetIds = new Set();
    for (const className in db) {
        for (const skillName in db[className]) {
            const id = skillMap[skillName];
            if (id) targetIds.add(id);
        }
    }

    console.log(`📊 待抓取目標：${targetIds.size} 個技能`);

    const results = {};
    let count = 0;
    const proxyBase = "https://proxy.kk69347321.workers.dev/?url=";

    for (const id of targetIds) {
        count++;
        try {
            const input = encodeURIComponent(JSON.stringify({ id: id.toString(), language: "zh" }));
            const targetUrl = `https://questlog.gg/aion-2/api/trpc/database.getSkill?input=${input}`;

            console.log(`[${count}/${targetIds.size}] 正在抓取 ID: ${id} (${names[id] || '未知'})...`);

            const resp = await fetch(proxyBase + encodeURIComponent(targetUrl));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const json = await resp.json();
            const rawData = json.result?.data?.json || json.result?.data || json.data;

            if (rawData) {
                // 只保留核心需要的欄位，節省空間
                results[id] = {
                    name: rawData.name,
                    icon: rawData.icon,
                    descriptionData: rawData.descriptionData,
                    levels: rawData.levels // 保留 levels 才能支援各等級數值
                };
            }
        } catch (e) {
            console.error(`❌ 抓取 ID: ${id} 失敗:`, e);
        }
        await new Promise(r => setTimeout(r, 200)); // 避免觸發 API 限制
    }

    console.log("✅ 抓取完成！");
    const output = "window.SKILL_DATA_STATIC = " + JSON.stringify(results, null, 2) + ";";

    // 自動下載
    const blob = new Blob([output], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skill_data_static.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log("-----------------------------------------");
    console.log("請將下載的檔案覆蓋至專案中的 js/skill_data_static.js");
    console.log("-----------------------------------------");
})();
