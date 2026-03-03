
import json
import urllib.request
import urllib.parse
import time
import os

# 1. 定義要抓取的技能名稱 (從 passive_skills.js 翻譯)
target_skill_names = [
    # 劍星
    "生存姿態", "保護盔甲", "掌握弱點", "攻擊準備", "衝擊擊中",
    # 守護星
    "體力強化", "庇護盾牌", "斷罪加護", "銅牆鐵壁", "侮辱咆哮", 
    # 殺星
    "第六感最大化", "瞄準破綻", "背後強擊", "強襲姿態",
    # 弓星
    "獵人決心", "警戒之眼", "集中之眼", "抵抗決心", "回生契約",
    # 魔道星
    "大地長袍", "火花長袍", "抵抗恩惠", "強化恩惠",
    # 精靈星
    "精靈打擊", "精靈保護", "侵蝕", "精神集中",
    # 治癒星
    "溫慢加護", "主神加護", "主神恩寵", "治癒力強化", "不死帳幕", "生存意志",
    # 護法星
    "生命祝福", "十字防禦", "鼓吹咒語", "激怒咒語", "大地約定", "風之約定"
]

# 2. 從 skill-names.js 讀取 ID 映射
# 這裡手動建立一些關鍵映射，或掃描檔案 (為了精確性，我直接列出剛才看到的)
# 實際上我應該從檔案讀取
skill_names_db = {
    "11710000": "生存姿態", "11720000": "保護盔甲", "11740000": "掌握弱點", "11750000": "攻擊準備", "11760000": "衝擊擊中",
    "12710000": "體力強化", "12720000": "庇護盾牌", "12730000": "斷罪加護", "12740000": "銅牆鐵壁", "12760000": "衝擊擊中", "12770000": "侮辱咆哮", "12790000": "生存意志",
    "13710000": "第六感最大化", "13720000": "瞄準破綻", "13740000": "背後強擊", "13750000": "強襲姿態", "13760000": "衝擊擊中",
    "14710000": "警戒之眼", "14740000": "集中之眼", "14750000": "獵人決心", "14760000": "抵抗決心", "14790000": "回生契約",
    "15720000": "大地長袍", "15740000": "火花長袍", "15770000": "抵抗恩惠", "15780000": "強化恩惠", "15790000": "回生契約",
    "16710000": "精靈打擊", "16720000": "精靈保護", "16740000": "侵蝕", "16760000": "精神集中", "16790000": "回生契約",
    "17710000": "溫暖加護", "17720000": "主神加護", "17730000": "主神恩寵", "17740000": "治癒力強化", "17750000": "不死帳幕", "17790000": "生存意志",
    "18710000": "生命祝福", "18720000": "十字防禦", "18740000": "鼓吹咒語", "18750000": "攻擊準備", "18760000": "衝擊擊中", "18770000": "激怒咒語", "18780000": "大地約定", "18800000": "風之約定"
}

def fetch_skill(skill_id):
    url = f"https://questlog.gg/aion-2/api/trpc/database.getSkill?input=%7B%22id%22%3A%22{skill_id}%22%2C%22language%22%3A%22zh%22%7D"
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            return data.get("result", {}).get("data", {}).get("json")
    except Exception as e:
        print(f"Error fetching {skill_id}: {e}")
        return None

results = {}
for skill_id, name in skill_names_db.items():
    print(f"Fetching {name} ({skill_id})...")
    data = fetch_skill(skill_id)
    if data:
        results[skill_id] = data
    time.sleep(0.3) # 避免太快

output_path = r"d:\c150075\Desktop\aiongame\js\skill_data_static.js"
with open(output_path, "w", encoding="utf-8") as f:
    f.write("window.SKILL_DATA_STATIC = ")
    json.dump(results, f, ensure_ascii=False, indent=2)
    f.write(";")

print(f"Done! Saved to {output_path}")
