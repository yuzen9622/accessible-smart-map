# Web 步行指引與 AI 路線一致性遷移

日期：2026-10-09。範圍為 `taipei-accessible-map`，依後端 `FRONTEND_MIGRATION_WALK_INSTRUCTIONS.md` 與 `FRONTEND_MIGRATION_AI_ROUTE_CONSISTENCY.md` 實作。未修改手機版與後端、未部署。

## 已實作

- AI route mapper 驗證版本、業務成功、候選 identity、起終點、偏好及各候選路段，移除 AI 自動再次規劃與 `(0,0)` 補值。缺少幾何的路段保留運具與站點，顯示資料不足。
- Route slice 一次套用完整候選、planId、selectedRouteId、canonical preferences、alerts、起終點與面板。手動規劃入口保留，並拒絕過期請求覆蓋新狀態。
- SSE 依 callId 配對工具參數／結果，保留後端 summary；請求附目前 routeContext、版本與個人偏好。取消、換選、清除對話、登出後拒絕晚到結果，失敗時停止該次回答。
- 語音初始化／重連附 shared history 與目前 routeContext，保留 turnId、callId 與 summary。收到能力宣告後才發送 route.context.set；等待最新 ack 時清空播放、阻擋上下行音訊。舊 ack、失敗與逾時不解除阻擋，重試只重送脈絡。同 callId 不重複套用。
- 分開正在導航與目前查看的路線。改道仍檢查 navigationId／routeVersion；查看其他候選時不強制改選，瀏覽候選不重設導航。
- 指引 HTTP 僅傳 token、heading、language；重新規劃附目前語言。英文相對方向對應導航箭頭，TTS 沿用直接朗讀後端 text。指引位置使用 leg-local index，進度 waypoint 優先採 cumulativeDistanceM；缺少指定路段幾何時不冒用另一段座標。
- 缺少 token 時顯示提示並禁用導航；INVALID_ROUTE_TOKEN 與其他 HTTP／網路失敗分別處理，保留舊路線供查看。

## 驗證

- TypeScript：`npx tsc --noEmit --pretty false` 通過。
- 本次修改檔案：Biome check 通過。
- Vitest：75 個測試檔、904 項測試通過，包含新增的契約、SSE、WS ack／音訊阻擋、候選換選延後同步、播放佇列結束、改道、跨 leg 索引與英文箭頭案例。
- Production build：`npm run build` 通過。
- 本機 Chromium＋production server，透過模擬 SSE 實際操作聊天與路線面板：指定第二候選正確套用；換選後追問送出新 token；摘要保留；兩次操作沒有額外 accessible-route 請求；舊版結果顯示錯誤；sessionStorage 聊天內容未包含 fixture token。
- `check:cycles` 未通過：既有 `lib/api/transit.ts ↔ lib/api/busParsers.ts` 循環，兩個 import 均已核對存在於原始 HEAD，並非本次新增。

## 尚待環境驗收

- 尚未驗證部署後端的 capabilities、真實 Gemini 音訊內容與實際麥克風／裝置播放。WS 測試使用可控制的 socket、PCM 與 callback，不能替代真實語音驗收。
- 本機瀏覽器使用 fixture 驗證新契約；外部設施 API 載入與定位在該測試環境失敗，未宣稱外部服務已整合通過。
- 本次為主代理實作與自查，未進行獨立代理審查。上線前仍須依後端文件第 8 節對齊真實 tool call、路線 identity、逐字稿與音訊，並遮蔽 token。


## 同日追加：React #185 導航回歸修正

使用者回報 map-dev 的 `/en/` 發生 React #185（Maximum update depth exceeded）。本機 production build 以固定路線結果重播後，按下「開始導航」可重現相同錯誤。根因是上一輪新增的 NavigationHUD selector 在 activeNavigationRoute 存在時，每次讀取都建立新的巢狀 `{ index, route }` 物件；useShallow 只比較一層，造成 useSyncExternalStore snapshot 不穩定與無限更新。

修正為直接選取 store 中的 route 參考，不再包裝巢狀物件。`NavigationHUD.snapshot.test.tsx` 擷取實際 HUD 的 useShallow selector：修正前 2 項失敗、1 項通過；修正後 3 項通過。案例涵蓋未導航、導航中、瀏覽其他候選與路線／位置真正改變。

重新建置後在本機 `/en/` 透過相同 fixture 實際按下 Start Navigation：正常顯示 Walk ahead、Steps、End Navigation，展開步驟列表正常，console 無 #185。TypeScript、修改檔案 Biome、全套 898 項測試與 production build 通過。

上一輪的瀏覽器驗證未進入導航，未能涵蓋此回歸；此次已補測。修正仍在本機工作樹，未部署至 map-dev。

## 同日追加：瀏覽候選時保留目前語音說明

依使用者明確調整的互動需求，導航前切換候選不再立即中斷目前說明。這項需求取代遷移文件中「換選立即中斷」的前端時機規則；後端協定不變。由於後端收到 route.context.set 也會重設上游語音，前端必須等 turn.complete 與本機音訊佇列播放完畢兩者皆成立後，才送出最後選中的路線。連續換選會合併為一次同步。

等待期間繼續接收及播放目前回答，暫停麥克風上傳，直到最新脈絡 ack 成功後恢復提問。開始導航、導航中路線變更、清除路線及 token 失效仍立即同步；結束連線會取消待送同步。播放完成使用 AudioBufferSourceNode.onended 判斷，清除或關閉舊 AudioContext 的晚到事件不會觸發同步。

新增回歸案例涵蓋雙條件等待、音訊片段之間的空檔、連續換選、立即同步覆蓋待送狀態、結束連線及舊播放事件。全套 904 項測試、TypeScript、修改檔案 Biome、production build 與 git diff --check 通過。另以 Chromium 真實 AudioContext 執行目前 playback/controller 程式碼，搭配模擬 socket：確認兩段 PCM 播完才送一次最新候選同步。此驗證未使用真實 Gemini、麥克風或部署服務。
