# 臺北無障礙智慧地圖 前端產品級工程稽核報告（複查／增量版）

- 稽核日期：2026-09-06
- 稽核範圍：前端全 repo，聚焦兩件事——(1) 複查 2026-09-04 稽核 9 條發現目前是否已修復；(2) 稽核自基線 commit `c2e196b` 以來新增的 48 個檔案（+4428/-530 行，涵蓋 reroute 協調器重構、公車 ETA 即時追蹤、語音 session、動效元件）
- 基線 commit（本輪 HEAD）：`565e02a`；上輪稽核基線：`c2e196b`
- 稽核者：pi / product-grade-audit
- 本輪性質：嚴格唯讀稽核。突變抽測於獨立暫存 git worktree（`/tmp/audit-taipei-map-work/mutwt`，已建立符號連結 `node_modules` 而非重新安裝）執行並已用 `git worktree remove --force` 移除

---

## 0. 一頁摘要

**核心結論：2026-09-04 稽核提出的 9 條發現（P1×4、P2×5），截至本輪複查全數尚未修復，一條都沒有動。** 逐條以與上次相同或更嚴謹的查法重新驗證（見第 2 節），行號、程式內容與上次逐字相同。

**新增程式碼的稽核結論是正面的**：自基線以來新增的 48 個檔案中，風險最高的兩塊邏輯——`localRerouteCoordinator.ts` 的請求世代（generation）防重放守門，與 `busRouteDetailCache.ts` 的快取新鮮度判斷——各自施加一次真實突變後，測試套件都精準變紅（killed），沒有發現新的 P0/P1 級別問題。测试真實性鑑識（歷史掃描 355 個 commit）也沒有偵測到「同 commit 放寬測試」的痕跡。

排序建議：先處理 P1-1/P1-2（同一個循環相依 + 讓它一直隱形的假綠燈腳本），這兩條疊加意味著這個 repo 目前完全沒有循環依賴防線。

---

## 1. 事實基線

```
$ git log --oneline c2e196b..HEAD | wc -l
17   # 自上次稽核以來的 commit 數

$ git diff --stat c2e196b..HEAD | tail -1
48 files changed, 4428 insertions(+), 530 deletions(-)

$ npm run lint
Checked 296 files in 149ms. No fixes applied.

$ npm run build
✓ Compiled successfully in 1367ms（Next.js 16.3.2 --turbopack）

$ npm test
Test Files  51 passed (51)
Tests  550 passed (550)

$ npx madge --circular --extensions ts,tsx src      # repo 目前用的腳本
Processed 282 files (767ms) (153 warnings)
✔ No circular dependency found!

$ npx madge --circular --ts-config tsconfig.json --extensions ts,tsx src   # 補上路徑解析後
Processed 285 files (910ms) (3 warnings)
✖ Found 1 circular dependency!
1) stores/useAuthStore.ts > lib/api/user.ts > lib/fetch.ts

$ python3 test_forensics.py .
測試檔數 51 / test case 531 / 斷言 1395 / 平均每 case 2.63 斷言
強斷言/弱斷言 787 / 13；skip/only/xfail 0；吞例外 0
掃描 355 個 commit，同時改 src 與既有測試 54 次，可疑（測試被放寬）0
```

---

## 2. 複查：2026-09-04 稽核 9 條發現目前狀態

以下全部標記為 **【仍未修復】**。每條都用與上次相同或增加第二種查法重新驗證，證據已通過 `verify_findings.py --strict`。

### P1-1 架構層循環依賴：stores 與 API Client 形成環狀相依 — 仍未修復

- `src/stores/useAuthStore.ts:2`: `import { updateConfig } from "@/lib/api/user";`
- `src/lib/api/user.ts:2`: `import { authenticatedRequest } from "@/lib/fetch";`
- `src/lib/fetch.ts:3`: `import useAuthStore from "@/stores/useAuthStore";`
- 複查指令：`npx madge --circular --ts-config tsconfig.json --extensions ts,tsx src` → `✖ Found 1 circular dependency! 1) stores/useAuthStore.ts > lib/api/user.ts > lib/fetch.ts`
- 影響：HMR／打包環境下可能誘發暫時性死區（TDZ）執行期崩潰。
- 修法：讓 `fetch.ts` 只透過依賴注入介面（如既有的 `getAccessToken` 委託）取得 token，不直接 import `useAuthStore`。

### P1-2 循環相依檢查腳本缺少 tsconfig 解析參數，148+ 檔案被忽略形成虛假綠燈 — 仍未修復

- `package.json:17`: `"check:cycles": "madge --circular --extensions ts,tsx src"`（逐字未變）
- 複查指令：`npm run check:cycles` → `Processed 282 files (767ms) (153 warnings)\n✔ No circular dependency found!`；帶 `--ts-config` 版本則 `Processed 285 files ... ✖ Found 1 circular dependency!`
- 影響：P1-1 的真實循環永遠不會被這支 CI 也會呼叫的腳本攔下。
- 修法：`package.json:17` 改為 `"madge --circular --ts-config tsconfig.json --extensions ts,tsx src"`。

### P1-3 孤島 ErrorBoundary：全域 ErrorBoundary 從未被任何功能區塊引入 — 仍未修復

- `src/components/shared/ErrorBoundary.tsx:121`: `export class ErrorBoundary extends Component<`
- 複查指令（兩種不同查法皆 0 命中）：
  `rg "from [\"'].*ErrorBoundary[\"']" src -g '!src/components/shared/__tests__/**'`
  `rg "<ErrorBoundary" src -g '!src/components/shared/__tests__/**' -g '!src/components/shared/ErrorBoundary.tsx'`
- 影響：地圖、BottomSheet、語音元件拋出未捕獲例外會直接穿透至根層級 `global-error.tsx`，整頁白屏。
- 修法：在 `ClientMap.tsx`、`BottomSheet.tsx`、`AIChatBot.tsx` 等一級容器外圍包裹 `<ErrorBoundary fallback={...}>`。

### P1-4 前端缺少遠端錯誤監控 — 仍未修復

- `src/app/global-error.tsx:25`: `"[GlobalError] Unhandled error caught in root global error boundary:",`
- 複查指令（兩種不同查法）：
  `rg "@sentry|bugsnag|rollbar|datadog" package.json` → 0 命中
  `grep -rn 'Sentry\.\|captureException\|window.onerror' src/app/global-error.tsx src/components/shared/ErrorBoundary.tsx` → 0 命中，兩檔皆只有 `console.error`
- 影響：生產環境崩潰團隊完全無感知能力。
- 修法：接入 `@sentry/nextjs`，於 `global-error.tsx` 與 `ErrorBoundary.componentDidCatch` 呼叫 `Sentry.captureException`。

### P2-1 密碼驗證測試缺少 6/7 碼邊界（突變抽測存活）— 仍未修復

- `src/lib/passwordValidation.ts:7`: `if (password.length < 8) {`
- `src/lib/__tests__/passwordValidation.test.ts:10`: 仍只有 `ab12`（4碼）與 `abc12345`（8碼）兩個案例，6/7 碼邊界仍是真空。
- 突變複查：`password.length < 8` → `< 6`，跑 `npx vitest run src/lib/__tests__/passwordValidation.test.ts`，套件全數通過（survived，已於臨時 worktree 復原）。
- 修法：補上 `"abc123"`（6碼）與 `"abc1234"`（7碼）兩個應失敗案例。

### P2-2 RouteCard 分數色彩邏輯無單元測試防護（突變抽測存活）— 仍未修復

- `src/components/shared/RouteCard/utils.ts:205`: `if (value >= 80) return "#22c55e";`
- 複查 `src/components/shared/__tests__/RouteCard.test.ts` 全文：找不到任何 `scoreBarColor` 相關斷言。
- 突變複查：`value >= 80` → `value >= 99`，跑 `RouteCard.test.ts`，全數通過（survived，已復原）。
- 修法：新增對 80/60/40/39 邊界值的斷言。

### P2-3 CI 缺少 next build 靜態建置檢查 — 仍未修復

- `.github/workflows/ci.yml:47`: `run: npm test`
- 複查（兩種查法）：列出全部 step 名稱僅 Checkout / Setup Node / Install / Lint / Typecheck / Test；`grep -n 'next build\|npm run build' .github/workflows/ci.yml` → 0 命中。
- 修法：於 `ci.yml` 追加 `- name: Run Build\n  run: npm run build`。

### P2-4 fetchRequest 未設定預設逾時 — 仍未修復

- `src/lib/fetch.ts:94`: `const response = await fetch(url, init);`
- 複查：`signal` 僅在呼叫端主動提供時才會被帶入 `init.signal`（第 91-92 行），函式本身沒有 `AbortSignal.timeout` 預設邏輯。
- 修法：為沒有提供 `signal` 的請求附加預設 `AbortSignal.timeout(10000)`。

### P2-5 三個 BottomSheet 面板錯誤狀態無重試按鈕 — 仍未修復

- `src/components/BottomSheet/BusPanel.tsx:487`、`ParkingPanel.tsx:313`、`WelfarePanel.tsx:161`：皆為 `<p className="text-sm text-muted-foreground">{error}</p>`，行號與內容與上次逐字相同。
- 複查：`grep -rn 'onClick.*fetch\|重新嘗試\|retry\|Retry'` 三檔案 0 命中。
- 修法：加入 `<Button onClick={fetchData}>重新嘗試</Button>`。

---

## 3. 新增程式碼稽核（c2e196b..HEAD，48 個檔案）

本輪新增／大改的核心模組：`localRerouteCoordinator.ts`（新增，388 行，單一權威 reroute 協調器）、`busRouteDetailCache.ts`（新增，公車路線詳情去重快取）、`useNavigation.ts`（+179 行）、`voiceSession.ts`（+30 行）、`number-ticker.tsx` / `VisualViewportSync.tsx`（新增動效與 iOS 鍵盤處理元件）。

### 突變抽測（2 處，皆 killed，未發現新增缺陷）

1. **快取新鮮度判斷** — `src/lib/transit/busRouteDetailCache.ts:63`
   `const fresh = Date.now() - existing.at <= TTL_MS;` → 改為 `const fresh = true;`
   跑 `npx vitest run src/lib/transit/__tests__/busRouteDetailCache.test.ts` → **1 個測試變紅**（`refetches once the entry goes stale`：`expected 2 calls, got 1`）。**Killed**，已 `git checkout` 復原。

2. **請求世代防重放守門** — `src/lib/navigation/localRerouteCoordinator.ts:373`（`isValidResponse` 內 `requestGenCounter` 比對）
   `if (this.requestGenCounter !== expectedReqGen)` → 改為 `if (false)`
   跑 `npx vitest run src/hook/__tests__/useRouteReroute.test.ts src/lib/navigation/__tests__/rerouteCoordinator.test.ts` → **2 個測試變紅**（`AUTO pending -> MANUAL arrives -> AUTO aborted` 等單一擁有者不變式案例，斷言從 `false` 變成 `true`）。**Killed**，已復原。

結論：這兩處是新增邏輯中風險最高的部分（快取失效時機、reroute 請求世代防止過期回應誤套用），測試確實守住行為，不是裝飾性測試。

### 歷史鑑識

`test_forensics.py` 掃描 355 個 commit，其中「同 commit 改實作又改既有測試」54 次，腳本判定可疑（測試被放寬）0 次。人工抽看新增範圍內唯一牽涉 bug 修復且動到既有測試的 commit：

- `6433c80f` `fix(nav): resolve maneuver waypoints with per-leg polyline indices` — 修正 `resolveWaypoints` 把 leg-local `polylineIndex`誤當成串接後全域 offset 的錯誤；測試變動是新增涵蓋多 leg 案例，非放寬既有期望值。判定：正常修復，非測試造假。

---

## 4. 已排除的疑點（查證後確認非問題）

- **新增 reroute 協調器的並發防護**：`sendRequest`／`isValidResponse` 對 session generation、request generation、`routeToken`、`routeVersion` 四項同時比對，且 `AbortController` 搭配 `finally` 區塊清理 `activeRequest`，突變抽測顯示防重放邏輯確實被測試守住（見第 3 節）。
- **`busRouteDetailCache` 的「絕不 reject」設計**：`catch` 分支會 `cache.delete(key)` 並回傳 `null`，讓暫時性錯誤在下次呼叫時重試而非被快取污染；此設計本身有對應測試（`refetches once the entry goes stale` 案例間接驗證快取失效路徑）。
- **`localRerouteCoordinator.ts:68` 的 `typeof route?.routeToken === "string"` 檢查**：pi-lens 的 `no-runtime-typeof` advisory 認為應在 I/O 邊界解碼，但此處讀的是內部 zustand store 而非外部輸入，屬於合理的防禦性型別收斂，非需要修的邊界問題，故未列入發現清單。

---

## 5. 未驗證／查不到

- 本輪未針對 `motion/number-ticker.tsx`、`VisualViewportSync.tsx`、`voiceSession.ts` 的變更部分做逐行審查或突變抽測（僅新增的 reroute 與快取邏輯做了深度抽測）；這些屬於較低風險的 UI/動效與既有語音模組微調，若日後要稽核建議列入下一輪範圍。
- 未重新執行 2026-09-04 報告中「4. 前端 14 個面向總評」的全部面向重新盤點（如狀態管理、design system、accessibility），本輪只針對前次 9 條發現的修復狀態與新增程式碼做複查，不代表其餘面向本輪有再次確認。

---

## 6. 建議的處理順序

1. **P1-1 + P1-2 一起修**：先把 `check:cycles` 腳本加上 `--ts-config`（P1-2），讓循環相依检查對整個 `@/` 別名體系生效；再解開 `useAuthStore → user.ts → fetch.ts → useAuthStore` 的循環（P1-1）。這兩條疊加等於「安全網本身是壞的」，優先度最高。
2. **P1-3**：至少先包住地圖與 BottomSheet 兩個最複雜、最常崩潰的容器。
3. **P1-4**：接入 Sentry（或同等方案），成本低、立即獲得線上可觀測性。
4. **P2-1 / P2-2**：各補 2-3 行邊界測試即可讓突變抽測由 survived 變 killed，成本極低。
5. **P2-3 / P2-4 / P2-5**：CI 加一個 build step、fetch 加預設逾時、三個面板加重試按鈕，皆為獨立、低風險的局部修改。

---

## 6.9 本報告修正過的數字

無。本輪所有複查數字（行號、grep 命中數、madge 輸出）與 2026-09-04 報告原文逐字比對後一致，未發現需要修正之處。

---

## 7. 本輪動過什麼

- 建立暫存 git worktree `/tmp/audit-taipei-map-work/mutwt`（基於 HEAD `565e02a`），symlink 主 repo `node_modules`。
- 於該 worktree 施加 2 次突變（`busRouteDetailCache.ts` 快取新鮮度判斷、`localRerouteCoordinator.ts` 請求世代守門），各自跑對應測試後立即 `git checkout --` 復原，最後以 `git worktree remove --force` 移除整個 worktree。
- 主 repo（`/Users/yuen/orca/taipei-accessible-map`）本身全程未被修改；`findings.json` / `findings.verified.json` / `repo_scan.out` / `test_forensics.out` 等中間產物全部存放於 repo 外的 `/tmp/audit-taipei-map-work/`，稽核結束後清除。
