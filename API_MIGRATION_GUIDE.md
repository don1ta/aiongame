# Aion2 官網 API 整合說明

## 📋 修改摘要

已成功將 Aion 查詢系統從第三方 API 改為**官網 tw.ncsoft.com API**。

## 🔧 主要變更

### 1. API 端點更新

**舊 API (第三方):**
```
https://aion-api.bnshive.com/character/query
```

**新 API (官網):**
```
步驟 1: https://tw.ncsoft.com/aion2/api/character/search
步驟 2: https://tw.ncsoft.com/aion2/api/character/equipment
```

### 2. Proxy 策略優化

```javascript
function getProxyUrl(url, forceProxy = false) {
    // 官網 API 直接呼叫 (避免 CORS 問題)
    if (!forceProxy && url.includes('tw.ncsoft.com')) {
        return url;
    }
    
    // 其他資源使用 Cloudflare Workers proxy
    return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;
}
```

**優點:**
- ✅ 官網 API 直接呼叫,速度更快
- ✅ 圖片等資源仍使用 proxy,避免 CORS
- ✅ 減少 proxy 負擔

### 3. 伺服器 ID 對照表

新增 36 個伺服器的 ID 對照:
```javascript
const SERVER_ID_MAP = {
    '尤斯迪埃': 1001,
    '塔哈巴達': 1011,
    '伊斯拉佩爾': 2001,
    // ... 等
};
```

## 🧪 測試步驟

### 方法 1: 瀏覽器測試

1. **開啟檔案**
   ```
   用瀏覽器開啟: c:\Users\zxc15\Documents\GitHub\aiongame\aion.html
   ```

2. **輸入測試資料**
   - 角色名稱: `飛揉護法乳`
   - 伺服器: `塔哈巴達`

3. **查看 Console (F12)**
   ```
   預期輸出:
   🔍 步驟 1: 查詢角色資料...
   查詢 URL: https://tw.ncsoft.com/aion2/api/character/search?...
   查詢狀態: 200
   ✓ 找到角色 ID: YcW3j99uVfhx6TS4OW_p1CeuwCr7nLJujQznc2d7ssM=
   📊 步驟 2: 獲取完整角色資料...
   ✓ 裝備資料獲取成功
   ✓ 完成!已顯示角色資料
   ```

### 方法 2: 本地伺服器測試

如果直接開啟 HTML 檔案仍有 CORS 問題,使用本地伺服器:

```powershell
# 在專案目錄執行
cd c:\Users\zxc15\Documents\GitHub\aiongame
python -m http.server 5500

# 或使用 Node.js
npx http-server -p 5500
```

然後訪問: `http://localhost:5500/aion.html`

## ⚠️ 可能的問題與解決方案

### 問題 1: CORS 錯誤 403

**原因:** 官網 API 可能限制跨域請求

**解決方案:**
1. 使用本地伺服器 (推薦)
2. 修改 `getProxyUrl` 函數,強制使用 proxy:
   ```javascript
   // 將這行
   if (!forceProxy && url.includes('tw.ncsoft.com')) {
   // 改為
   if (false) {  // 強制所有請求都使用 proxy
   ```

### 問題 2: Cloudflare Workers Proxy 失效

**解決方案:** 切換到 AllOrigins
```javascript
// 註解掉這行
// return `https://proxy.kk69347321.workers.dev/?url=${encodeURIComponent(url)}`;

// 取消註解這行
return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
```

### 問題 3: 找不到角色

**檢查項目:**
- ✅ 角色名稱是否正確 (區分大小寫)
- ✅ 伺服器選擇是否正確
- ✅ 伺服器 ID 對照表是否完整

## 📊 API 回應格式

### 搜尋 API 回應
```json
{
  "characterId": "YcW3j99uVfhx6TS4OW_p1CeuwCr7nLJujQznc2d7ssM=",
  "characterName": "飛揉護法乳",
  "serverId": 1011
}
```

### 裝備 API 回應
```json
{
  "profile": { ... },
  "stat": { ... },
  "equipment": { ... },
  "daevanionBoardList": [ ... ],
  "ranking": { ... }
}
```

## 🎯 下一步建議

1. **測試多個角色** - 確保不同伺服器都能正常查詢
2. **檢查資料完整性** - 確認所有欄位都正確顯示
3. **效能優化** - 如果需要,可以加入快取機制
4. **錯誤處理** - 增強錯誤提示訊息

## 📝 備註

- 官網 API 可能有速率限制,請勿頻繁查詢
- 建議在 GitHub 上部署時使用 GitHub Pages,可以避免本地 CORS 問題
- 如果需要更新伺服器列表,請修改 `SERVER_ID_MAP` 對照表
