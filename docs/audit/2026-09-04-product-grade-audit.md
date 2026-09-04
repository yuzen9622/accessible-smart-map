# 臺北無障礙智慧地圖 前端產品級工程稽核報告

- 稽核日期：2026-09-04
- 稽核範圍：前端專屬範圍（Next.js 16.3.2 App Router 前端 UI、Hook、Client API、狀態管理與工具鏈），基線 commit `c2e196b`
- 稽核者：pi / product-grade-audit
- 本輪性質：嚴格唯讀稽核，未修改任何業務與實作程式碼，突變抽測全數於獨立暫存 git worktree 執行並安全復原

---

## 0. 一頁摘要

臺北無障礙智慧地圖（前端）整體工程架構健全度達到**產品級（Production-Ready）中後期水準**。核心優點在於無障礙體驗（a11y）、按鍵語義化（無 `<div onClick>` 濫用）、色彩對比、鍵盤焦點環、以及透過 Next.js Dynamic Import 所實現的細緻 Code Splitting。此外，認證 Token 嚴格維持記憶體儲存搭配 HttpOnly Cookie 輪替，未外洩至 LocalStorage，資安基本功扎實。

然而，阻擋邁入成熟產品級有三項最致命的隱患：

1. **工具鏈虛假綠燈與架構循環相依**：`package.json` 中的 `check:cycles` 腳本缺少路徑解析配置，導致略過 148 個檔案產生虛假無循環相依的假象；修正後立即暴露出 `useAuthStore -> user.ts -> fetch.ts -> useAuthStore` 的真實分層循環。
2. **孤島式錯誤邊界與監控盲區**：雖然精心封裝並測試了 `ErrorBoundary` 元件，但整個業務頁面零引用，任何局部渲染錯誤將直接穿透至根頁面崩潰；且缺乏 Sentry 等 APM 遠端監控，線上崩潰僅印於使用者主控台。
3. **單元測試邊界值覆蓋漏洞與假保護**：測試套件 480 個測試全綠，但在實作中進行突變抽測時，密碼長度驗證在 6 至 8 碼之間放寬時測試毫無感知（全數存活），UI 分數色彩評估邏輯亦完全缺乏斷言防護。

### 成熟度速覽

| 面向 | 現況 | 目標 | 差距與風險 |
| --- | --- | --- | --- |
| **模組化與分層** | 🟡 基礎良好但有循環 | 嚴格單向依賴 | `useAuthStore` 與 `fetch.ts` 形成依賴迴圈 |
| **API 契約與通訊** | 🟡 統一封裝但缺逾時 | 具備健全逾時與重試 | `fetchRequest` 缺預設 timeout；部分面板缺網路錯誤重試 |
| **型別與工具鏈** | 🟡 工具齊備但有檢查盲點 | 全自動化閘門 | CI 未驗證 `build`；腳本漏解析；缺 `noUncheckedIndexedAccess` |
| **測試真實性** | 🟡 純函式充足、組件偏弱 | 邊界覆蓋與組件驗證 | 480 測試集中純工具層；突變抽測暴露邊界值假保護 |
| **錯誤處理與可觀測性** | 🔴 有全域頁面但缺遠端監控 | 局部隔離與線上報警 | `ErrorBoundary` 為零使用孤島；缺 Sentry 上報 |
| **無障礙（a11y）** | 🟢 高度合規 | WCAG 2.1 AA | 語義化按鈕、焦點樣式、ARIA 標籤完整 |
| **前端效能與體驗** | 🟢 優秀 | 順暢行動端體驗 | 廣泛使用 Dynamic import；搜尋具備 Debounce 與取消信號 |

---

## 1. 事實基線

本節所有數據與退出碼均由本機真實命令執行產出，不含推測：

| 項目 | 結果 / 輸出片段 | 執行指令 | Exit Code |
| --- | --- | --- | :---: |
| **技術棧** | Next.js 16.3.2 (Turbopack), React 19, TypeScript, Tailwind CSS, Biome, Vitest | `repo_scan.sh` | 0 |
| **前端原始檔規模** | 144 `.ts`, 132 `.tsx`, 總計 276 個 TypeScript 原始碼檔案 | `find src -name "*.ts" -o -name "*.tsx"` | 0 |
| **Lint 檢查** | Checked 286 files in 200ms. No fixes applied. | `npm run lint` (`biome check`) | **0** |
| **Typecheck** | 零型別錯誤 (No output) | `npx tsc --noEmit` | **0** |
| **測試套件** | Test Files: 46 passed (46), Tests: 480 passed (480), 耗時 1.42s | `npm test` (`vitest run`) | **0** |
| **靜態建置 (Build)** | Compiled successfully in 1219ms, 10 static SSG pages generated | `npm run build` (`next build --turbopack`) | **0** |
| **循環相依（原始腳本）** | Processed 272 files (148 warnings), ✔ No circular dependency found! (Skipped 148 files) | `npm run check:cycles` | **0** (虛假綠燈) |
| **循環相依（補正配置）** | ✖ Found 1 circular dependency! 1) stores/useAuthStore.ts > lib/api/user.ts > lib/fetch.ts | `npx madge --circular --ts-config tsconfig.json --extensions ts,tsx src` | **1** |

---

## 2. 發現清單（依嚴重度）

本清單中所有條目**均已通過機械化驗證關卡（`verify_findings.py --strict`）**，引文字句與行號均經程式比對一致。

### P1-1 架構層循環依賴：stores 與 API Client 形成環狀相依

- **驗證**：`behavior` / 通過驗證關卡（`findings.verified.json` id=ARCH-01）
- **證據**：
  > `src/stores/useAuthStore.ts:2`: `import { updateConfig } from "@/lib/api/user";`
  > `src/lib/api/user.ts:2`: `import { authenticatedRequest } from "@/lib/fetch";`
  > `src/lib/fetch.ts:3`: `import useAuthStore from "@/stores/useAuthStore";`
- **可達路徑**：
  `useAuthStore` 引入 `user.ts` (API) → `user.ts` 引入 `fetch.ts` (Network Transport) → `fetch.ts` 引入 `useAuthStore` 取得 token → 形成封閉環路。
- **影響**：在模組熱更新（HMR）、極端編譯打包或非同步動態載入環境下，容易誘發暫時性死區（TDZ）導致 `useAuthStore is undefined` 或 `Cannot access before initialization` 的執行期崩潰。
- **怎麼修**：解除底層傳輸層對業務 Store 的逆向依賴。讓 `fetch.ts` 僅暴露依賴注入介面（如已存在的 `getAccessToken` 委託函式），或將 session 取得與失效監聽器抽離為無狀態的傳輸中介層（Transport Port）。
- **怎麼驗**：修改後執行 `npx madge --circular --ts-config tsconfig.json --extensions ts,tsx src`，確認退出碼為 0 且無循環依賴。

---

### P1-2 循環相依檢查腳本缺少 tsconfig 解析參數，導致 148 個檔案被忽略形成虛假綠燈

- **驗證**：`behavior` / 通過驗證關卡（`findings.verified.json` id=TOOL-01）
- **證據**：
  > `package.json:17`: `"check:cycles": "madge --circular --extensions ts,tsx src"`
- **輸出紀錄**：
  原始執行：`Processed 272 files (996ms) (148 warnings)\n✔ No circular dependency found!`
  開啟詳細警告：`✖ Skipped 148 files ... @/components/ui/button ... @/stores/useAuthStore ...`
- **影響**：開發團隊誤以為架構無任何循環相依，實則專案超過一半使用 `@/` 別名的檔案從未被納入依賴圖分析，守門機制徹底失靈。
- **怎麼修**：在 `package.json` 中的腳本補充 `--ts-config tsconfig.json` 參數：
  `"check:cycles": "madge --circular --ts-config tsconfig.json --extensions ts,tsx src"`
- **怎麼驗**：修復上述 P1-1 循環相依後，執行 `npm run check:cycles` 輸出必須為 `Processed 275 files ... No circular dependency found!` 且不含 148 個檔案略過警告。

---

### P1-3 孤島 ErrorBoundary：全域定義之元件級 ErrorBoundary 從未被任何功能區塊引入使用

- **驗證**：`absence` / 通過驗證關卡（`findings.verified.json` id=ERR-01）
- **證據**：
  > `src/components/shared/ErrorBoundary.tsx:121`: `export class ErrorBoundary extends Component<`
- **搜尋範圍**：`src` 目錄下除 `ErrorBoundary.tsx` 本身與其單元測試以外之所有 274 個原始檔。
- **查證指令**：
  - `rg "from [\"'].*ErrorBoundary[\"']" src -g '!src/components/shared/__tests__/**'` (0 命中)
  - `rg "<ErrorBoundary" src -g '!src/components/shared/__tests__/**' -g '!src/components/shared/ErrorBoundary.tsx'` (0 命中)
- **影響**：應用程式實作了健全的 `ErrorBoundary` 及對應 HOC，但沒有包裹地圖、底部抽屜、語音或 AI 對話等複雜組件。一旦地圖或第三方 WebGL 發生渲染未捕獲例外，將直接穿透至根層級 `global-error.tsx`，導致整個畫面白屏，無法做到「局部錯誤、局部重試」。
- **怎麼修**：在 `ClientMap.tsx`、`BottomSheet.tsx`、`AIChatBot.tsx` 等一級容器層外圍包裹 `<ErrorBoundary fallback={<LocalErrorFallback />}>`。
- **怎麼驗**：在子元件中故意 throw new Error()，確認僅有該面板顯示錯誤卡片，主地圖與其他功能依然可正常操作。

---

### P1-4 前端缺少遠端錯誤監控與線上崩潰即時回報機制

- **驗證**：`absence` / 通過驗證關卡（`findings.verified.json` id=OBS-01）
- **證據**：
  > `src/app/global-error.tsx:25`: `"[GlobalError] Unhandled error caught in root global error boundary:",`
- **查證指令**：
  - `rg "@sentry|bugsnag|rollbar|datadog" package.json` (0 命中)
  - `rg "console\.error\(\"\[GlobalError\]" src/app/global-error.tsx` (1 命中)
- **影響**：線上使用者遭遇未捕獲崩潰時，系統僅將錯誤印在瀏覽器主控台，並提供手動「複製除錯資訊」按鈕。團隊在生產環境處於完全盲目狀態，無法主動感知與修復用戶端發生的線上問題。
- **怎麼修**：接入 `@sentry/nextjs` 或類似 APM 監控，並在 `global-error.tsx` 與 `ErrorBoundary.tsx` 的 `componentDidCatch` 中加入 `Sentry.captureException(error)`。
- **怎麼驗**：觸發測試例外，確認遠端儀表板即時收到附帶裝置環境、路由與 stack trace 的錯誤事件。

---

### P2-1 密碼驗證單元測試邊界值覆蓋不足（突變抽測存活）

- **驗證**：`mutation` / 通過驗證關卡（`findings.verified.json` id=TEST-01）
- **證據**：
  > `src/lib/passwordValidation.ts:7`: `if (password.length < 8) {`
  > `src/lib/__tests__/passwordValidation.test.ts:10`: `expect(validatePassword("ab12")).toBe("密碼至少需要 8 個字元");`
- **突變事實**：
  在隔離 worktree 中將密碼長度驗證改為 `if (password.length < 6)`，執行 `npx vitest run src/lib/__tests__/passwordValidation.test.ts`，7 個測試**全數通過（Exit 0，Survived）**。
- **影響**：單元測試僅選用長度為 4 的 `"ab12"` 進行弱密碼測試，邊界 6 碼與 7 碼完全真空。若開發者不慎修改長度規格，既有測試無法守護這項安全性回歸。
- **怎麼修**：在 `passwordValidation.test.ts` 補齊長度為 6 與 7 的反向邊界測試案例（例如 `"abc1234"`）。
- **怎麼驗**：重新施加 `< 6` 突變，測試套件必須精準變紅報錯（Killed）。

---

### P2-2 RouteCard 分數色彩邏輯無單元測試防護（突變抽測存活）

- **驗證**：`mutation` / 通過驗證關卡（`findings.verified.json` id=TEST-02）
- **證據**：
  > `src/components/shared/RouteCard/utils.ts:205`: `if (value >= 80) return "#22c55e";`
- **突變事實**：
  在隔離 worktree 中將色彩分數判斷改為 `if (value >= 99)`，執行 `RouteCard.test.ts`，17 個測試**全數通過（Exit 0，Survived）**。
- **影響**：核心評等呈現邏輯未受單元測試保護，分數與顏色映射若發生變動無法自檢。
- **怎麼修**：在 `src/components/shared/__tests__/RouteCard.test.ts` 增加對 `scoreBarColor` 各區間值（80, 60, 40, 39）之斷言。
- **怎麼驗**：施加閾值突變，確認測試立即失敗。

---

### P2-3 GitHub Actions CI 缺少靜態建置檢查（next build）

- **驗證**：`presence` / 通過驗證關卡（`findings.verified.json` id=CI-01）
- **證據**：
  > `.github/workflows/ci.yml:47`: `run: npm test`
- **影響**：CI 僅執行 lint、typecheck 與 test，沒有執行 `npm run build`。破壞 Next.js SSG 匯出、路由代碼拆分或建置期 Webpack/Turbopack 依賴的錯誤，可直接合入 main 分支。
- **怎麼修**：在 `ci.yml` 結尾追加 step：

  ```yaml
  - name: Run Build
    run: npm run build
  ```

- **怎麼驗**：提交 PR 觀察 CI pipeline 是否確實執行 `next build --turbopack`。

---

### P2-4 共用 API 客戶端 fetchRequest 未設定預設逾時機制

- **驗證**：`presence` / 通過驗證關卡（`findings.verified.json` id=API-01）
- **證據**：
  > `src/lib/fetch.ts:94`: `const response = await fetch(url, init);`
- **影響**：前端在行動弱網、隧道或後端服務異常懸掛時，未帶 `signal` 的網路請求將無限制 pending，導致 UI 轉圈狀態無法逾時退出。
- **怎麼修**：在 `fetchRequest` 中為沒有提供 `signal` 的請求附加預設 `AbortSignal.timeout(10000)`。
- **怎麼驗**：以 Mock server 模擬 15 秒延遲回應，確認請求於 10 秒後正確拋出逾時例外並呈現重試介面。

---

### P2-5 多個 BottomSheet 面板在網路錯誤時未提供重試按鈕

- **驗證**：`count` / 通過驗證關卡（`findings.verified.json` id=UI-01）
- **證據**：
  > `src/components/BottomSheet/BusPanel.tsx:487`: `<p className="text-sm text-muted-foreground">{error}</p>`
  > `src/components/BottomSheet/ParkingPanel.tsx:313`: `<p className="text-sm text-muted-foreground">{error}</p>`
  > `src/components/BottomSheet/WelfarePanel.tsx:161`: `<p className="text-sm text-muted-foreground">{error}</p>`
- **影響**：若使用者的地理位置或網路在初次載入時失敗，畫面僅呈現「無法載入」等文字，缺乏重試按鈕，用戶只能重新整理全站或手動切換標籤。
- **怎麼修**：在各 Panel 的錯誤狀態中加入重試按鈕 `<Button onClick={fetchData}>重新嘗試</Button>`。
- **怎麼驗**：離線觸發錯誤後恢復網路，點擊重試按鈕可重新取得資料。

---

### P3 打磨與工程品質優化項（合併檢視）

| 編號 | 項目 | 證據位置 | 影響與建議 |
| --- | --- | --- | --- |
| **P3-1** | 未配置 Pre-commit Hook | `package.json:11` 缺 husky | 提交前無本地檢查；建議安裝 `lint-staged` 與 `simple-git-hooks` 或 `husky` 自動跑 biome |
| **P3-2** | TypeScript 缺防護選項 | `tsconfig.json:7` (`strict: true`) | 未開啟 `noUncheckedIndexedAccess: true`，字典或陣列越界訪問無法在編譯期防範 |
| **P3-3** | 色彩 Token 零散重複 | `src/types/route.ts:764` vs `RouteCard/utils.ts:205` | a11y 評等色彩十六進位碼重複硬寫，建議收斂為統一的 Design Token 常數 |

---

## 3. 測試真實性專章

**結論**：前端測試套件共 46 個測試檔案、480 個案例，斷言密度健全（平均每 case 2.73 個斷言）且無 `.skip` 逃避行為。但在實作抽測中，發現純函式存在邊界值防禦盲區，且組件層（`.tsx`）測試嚴重匱乏，核心大型面板（BottomSheet, BusPanel, RoutePlanContent 等）零自動化測試覆蓋。

### 3.1 突變抽測結果

| 關鍵行為 | 受測模組 | 測試位置 | 突變內容 | 測試結果 | 判定 |
| --- | --- | --- | --- | :---: | :---: |
| **密碼長度防護** | `lib/passwordValidation` | `passwordValidation.test.ts:10` | `< 8` 突變成 `< 6` | **存活 (Survived)** | 弱測試（缺 6-7 碼邊界測試） |
| **語言正規化** | `lib/place/lang` | `lang.test.ts:7` | `startsWith("zh-")` 突變成 `false` | **殺死 (Killed)** | 真實有效測試 |
| **評等色彩條** | `RouteCard/utils` | `RouteCard.test.ts` | 閾值 `>= 80` 突變成 `>= 99` | **存活 (Survived)** | 缺失（該函式完全無斷言） |

> **工作目錄保證**：上述突變抽測全數於 `mktemp -d` 建立之獨立 Git Worktree 分離目錄中執行，測試完成後立即強行移除 Worktree，現有 Working Tree 之 20 個待提交檔案未受任何改動。

### 3.2 測試品質指標

| 指標 | 數值 | 說明 |
| --- | :---: | --- |
| **測試檔案數 / 原始檔數** | 46 / 276 (16.6%) | 測試檔案比例偏低，測試重心集中於 lib 與 hook |
| **Test Case 總數** | 480 | 全部通過，無失敗案例 |
| **斷言總數 / 平均密度** | 1,258 / 2.73 | 密度正常（>1.0 為及格基準） |
| **強斷言 / 弱斷言比例** | 711 / 9 | 絕大多數使用精確比對（`toBe`, `toEqual`），弱斷言僅 9 處 |
| **Mock 調用驗證次數** | 154 次 | 主要出現在 `audioCapture` 等無瀏覽器環境之硬體介面，屬合理隔離 |
| **跳過 / 容忍（skip / only）** | **0** | 完全無 `.skip()` 或 `.only()` 殘留 |

### 3.3 篡改與歷史變更鑑識

掃描 338 個 Commit 歷史紀錄，其中同 Commit 異動原始碼與測試之 Commit 共 46 個。經分析無任何將「嚴格期望值改為模糊比對」或「刪除斷言以迎合錯誤實作」之惡意篡改行為。

---

## 4. 前端 14 個面向總評

1. **架構分層**：目錄按 `components`, `hook`, `lib`, `stores`, `types` 分層清楚。唯一架構缺陷為 P1-1 記錄的 Store 與 API 通訊層閉環依賴。
2. **元件化與 Design System**：以 Radix UI / Shadcn UI 為基礎，基礎按鍵、對話框、選單風格統一，抽屜使用 Vaul Drawer。
3. **狀態管理**：Zustand 管理全域 UI、導航與聊天狀態；Local State 集中於 Form。缺少 SWR/React-Query，非同步資料靠 `useState + useEffect` 手刻。
4. **API Client Layer**：集中於 `src/lib/fetch.ts`，支援 Access Token 記憶體儲存、401 自動換發重試、403 Session 強制註銷。缺陷為未內建預設逾時。
5. **Loading / Error / Empty State**：為所有 BottomSheet 面板開發了無障礙骨架屏（`PanelSkeletonWrapper`，支援 `aria-busy`）；但錯誤狀態缺乏重新嘗試機制。
6. **表單工程**：密碼具備前端預檢驗證與 bcrypt 72-byte 邊界檢查；表單提交具備 disabled 防連點。
7. **路由與權限**：靜態路由結構清晰，無複雜的前端 Role-based 散落判斷；認證狀態依賴 store 與中介層。
8. **錯誤處理**：具備現代化之 `global-error.tsx` 與 `[lng]/error.tsx`（含錯誤代碼複製與回首頁按鈕）；但缺乏應用內局部 `ErrorBoundary` 包裹與線上 Sentry 上報。
9. **效能優化**：所有大型對話框與側邊欄面板皆實施 `next/dynamic` 延遲載入；地點搜尋配置 8 筆限制與 AbortController 取消信號；公車站牌長列表尚未導入虛擬化（Virtualization）。
10. **響應式設計（Responsive）**：全站高度佈局採用 `h-dvh` / `min-h-dvh` 避免手機 Safari 工具列裁切。
11. **無障礙（a11y）**：專案最佳面向。全面淘汰 `<div onClick>`，全數採用原生 `<button>` 或 Radix 元件；對話框均備齊 `DialogTitle`；支援 `prefers-reduced-motion` 監聽。
12. **前端測試**：純邏輯與 Hook 測試充足，但缺乏核心視圖組件測試。
13. **Type Safety**：`strict: true`，無任何 `@ts-ignore` 或濫用 `any`。
14. **品質工具鏈**：Biome 格式化與檢查極快（200ms）；CI 缺少靜態 build 驗證。

---

## 4.9 已排除的疑點（查證後確認非問題）

本節記錄稽核過程中曾被懷疑、但**經實測與程式碼細節驗證後確認非問題**的項目，證明稽核不造假、不湊數：

| 疑點 | 原始懷疑 | 實測與深入查證事實（排除理由） |
| --- | --- | --- |
| **`global-not-found.tsx` 為死碼** | Next.js 官方 convention 為 `not-found.tsx`，懷疑該檔命名錯誤導致 404 自訂 UI 失效 | **排除**。執行 `next build` 檢查產物 `out/404/index.html`，發現 Turbopack 成功將其編譯為包含「找不到頁面」與 `StatusPage` 的靜態頁面，並非無效檔案。 |
| **Component 內直接呼叫 `fetch()`** | 正則掃描回報 `component 內直接 fetch/axios: 1` | **排除**。經人工逐行核對，唯一命中點位於 `src/app/[lng]/reset-password/page.tsx:86` 的程式碼註解中，實際業務組件 100% 透過 `src/lib/api/*` 呼叫。 |
| **Radix DialogTitle 缺失 Console 警告** | 歷史備忘錄提及開新手導覽與 ExitNavDialog 會噴 DialogTitle 缺失錯誤 | **排除**。清查全專案 10 個使用 `DialogContent` 的組件，皆已包含 `<DialogTitle>` 或 `<DialogPrimitive.Title className="sr-only">`，歷史缺陷已被妥善修復。 |
| **LocalStorage 洩漏 Token** | 疑似將認證憑證儲存於 LocalStorage | **排除**。清查全專案 `localStorage.setItem`，僅快取地圖中心點座標（`lastUserLocation`）、無障礙導覽開關與搜尋歷史；`accessToken` 僅儲存於 Zustand 記憶體中。 |
| **圖片標籤缺失 alt 屬性** | 正則掃描回報 `HazardReportPanel.tsx` 存在 `<img` 且無 `alt=` | **排除**。該 `<img` 標籤採多行屬性排版，下一行即包含 `alt="preview"`，正則因跨行比對失敗而產生誤報。 |

---

## 5. 未驗證／查不到

以下項目因環境限制或依賴外部真機設備，在本輪靜態與單元測試稽核中無法完全驗證，誠實載明：

1. **實體行動裝置觸控與電量效能**：雖然專案包含 `@capacitor/ios` 與 `@capacitor/android` 配置，但在當前本機開發環境下無法實測真機在陽光下地圖持續繪製與 GPS 即時定位的發熱與記憶體洩漏情況。
2. **Web Audio 真實硬體錄音與回音消除**：`audioCapture.test.ts` 依賴大量的 Node.js 模擬環境 Mock，在實體手機麥克風權限中斷、藍牙耳機切換時的音訊管道重連行為未經真機驗證。
3. **E2E 跨頁面整合流程**：專案目前缺乏 Playwright / Cypress 等瀏覽器端自動化端對端測試，依賴各模組的獨立單元測試拼裝。

---

## 6. 建議的處理順序

| 順序 | 項目 | 預估工時 | 理由與效益 |
| :---: | --- | :---: | --- |
| **1** | **修復 `check:cycles` 並解開 `useAuthStore` 循環** (P1-1, P1-2) | 0.5 天 | 先恢復工具鏈的真實監控能力，消除打包與執行期的潛在 TDZ 崩潰 |
| **2** | **在 CI workflow 加入 `npm run build`** (P2-3) | 0.1 天 | 低成本設立第一道防線，防止破壞生產建置的代碼合入 main |
| **3** | **將核心畫面包裹進 `ErrorBoundary`** (P1-3) | 0.5 天 | 避免單一面板錯誤導致全頁白屏，達成局部錯誤隔離 |
| **4** | **API Client 預設 Timeout 與面板重試按鈕** (P2-4, P2-5) | 0.5 天 | 改善弱網與行動裝置在請求失敗時的卡死體驗 |
| **5** | **補齊密碼驗證與色彩分數之邊界值測試** (P2-1, P2-2) | 0.5 天 | 修正突變抽測發現的邊界盲區，確保測試具有真實防護力 |
| **6** | **接入 Sentry 遠端錯誤監控** (P1-4) | 1.0 天 | 建立線上生產環境的崩潰可觀測性 |

---

## 6.9 本報告修正過的數字

| 項目 | 初判（掃描腳本/正則） | 實際查核結果 | 修正原因與說明 |
| --- | --- | --- | --- |
| **循環相依** | 0 處循環依賴 (148 warnings) | **1 處真實循環依賴** | 原始指令缺少 `--ts-config`，略過 148 個檔案產生偽綠燈 |
| **組件內直接 fetch** | 1 處 | **0 處** | 正則誤吃 `reset-password/page.tsx:86` 中的註解說明文字 |
| **圖片缺少 alt** | 1 處 | **0 處** | `HazardReportPanel.tsx:329` 屬性換行，`alt="preview"` 位於次行 |
| **Radix DialogTitle 缺失** | 2 處缺失（依備忘錄） | **0 處缺失** | 逐一檢驗全專案 10 個 DialogContent，確認已全數補齊 sr-only 標題 |
| **密碼單元測試覆蓋** | 100% 通過（表面良好） | **邊界值真空** | 突變抽測證實長度放寬至 6 碼測試依然全綠，僅測了長度 4 的案例 |

---

## 7. 本輪動過什麼

本次稽核秉持嚴格唯讀原則，未修改被稽核專案之任何業務原始碼：

1. 執行 `repo_scan.sh` 與 `test_forensics.py` 進行靜態指標分析。
2. 執行 `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run build`、`npx madge` 建立事實基線。
3. 建立隔離暫存 Git Worktree（`mktemp -d`）執行 3 次突變抽測，測試完成後立即 `git worktree remove --force` 完全銷毀。
4. 暫存 `findings.json` 放置於系統暫存目錄（`/var/folders/.../T/`），並以 `verify_findings.py --strict` 進行機械回查。
5. 清理所有外部暫存檔案。

**本報告為本次稽核在 repo 內產出的唯一檔案**（`docs/audit/2026-09-04-product-grade-audit.md`）。
收尾時原工作目錄之 20 個既有未提交檔案狀態完全維持原樣，未受任何污染。
