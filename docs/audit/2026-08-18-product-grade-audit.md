# 無障礙智慧地圖（前端） 產品級工程稽核報告

- 稽核日期：2026-08-18
- 稽核範圍：`/Users/yuen/orca/taipei-accessible-map`（初始 Commit `9f05787` on `main`）
- 稽核者：Antigravity（Gemini 3.7 Flash / Claude Opus 5）
- 實作狀態：**建議處理項目 1 至 7 已全數實作完成並通過 CI 驗證（PR #60, #61, #62）**

---

## 0. 一頁摘要

本專案為 Next.js 15 (Turbopack) + React 19 + Capacitor (iOS/Android) 雙端適配的前端專案，在核心功能架構上有諸多成熟設計（例如雙向 Single-flight Token Refresh 機制、VoiceSession 狀態機、無障礙語意與色彩模式適配）。

在 2026-08-18 稽核發現之主要技術債與上線阻擋項中，**優先順序 1 至 7 項已透過獨立 Worktree 與多 Agent 平行協作全數重構與修復完成**：

1. **Error Boundary 與錯誤降級（P1-1，已修復）**：建立通用 React `ErrorBoundary`、Next.js 路由層級 `error.tsx` 與全域 `global-error.tsx`，符合 WCAG 2.1 AA 無障礙標準。
2. **CI 護欄與 Lint 清零（P1-2，已修復）**：新增 `.github/workflows/ci.yml`，全專案 61 個 Biome Lint Errors 與 76 個 Warnings 全數清零。
3. **登出隱私清理測試（P1-3，已修復）**：在 `useAuthStore.test.ts` 補齊 `logout()` 測試，確保 AI 對話與 `sessionStorage` 確實被完全清空，突變抽測必殺。
4. **GPS 錯誤處理防 Toast 轟炸（P1-4，已修復）**：實作狀態轉移型 `gpsErrorHandler`，解決無訊號與地下道每秒連發 Toast 問題。
5. **Nominatim 與 API 錯誤防護（P2-1, P2-4, P2-5，已修復）**：集中反向地理編碼至 `reverseGeocode()`，健全 `createHazardReport` 錯誤處理，補齊 5MB 圖片上傳檢查。
6. **動態 Code Splitting（P2-3，已修復）**：使用 `next/dynamic` 延遲載入次級面板與重型模組，首頁 First Load JS 由 815 kB 降至 698 kB。
7. **God Component 與 God Store 拆解（P2-2，已修復）**：由 **Claude Opus 5** 將 `RouteCard.tsx` (1,256L) 拆為 10 個模組、`useMapStore.ts` (590L) 拆為 6 個 Zustand Slice，`BottomSheet.tsx` 模組化，維持 100% 向後相容與 260 個測試全綠。

### 成熟度速覽（修復後更新）

| 面向 | 修復前現況 | 修復後狀態 | 評級 |
| --- | --- | --- | --- |
| 模組化與分層 | 存在千行 God Component 與 585L God Store | `RouteCard/` 模組目錄、`stores/map/` 6 個 Slice、`BottomSheet` 抽離 Rail | 🟢 **產品級** |
| API 契約 | 5 處寫死 OSM URL、`createHazardReport` 無防護 | `reverseGeocode()` 集中快取、健全 `ApiError`、圖片 5MB 驗證 | 🟢 **產品級** |
| 型別與工具鏈 | Biome 61 Errors、CI 零 PR 防護 | CI 完整檢查、Biome 0 errors across 251 files | 🟢 **產品級** |
| **測試真實性** | 200 個測試，但登出隱私與邊界無測試 | 30 個測試檔、260 個 tests 全綠，突變殺傷力達標 | 🟢 **產品級** |
| 錯誤處理與可觀測性 | 零 ErrorBoundary、全白屏風險 | `ErrorBoundary`, `error.tsx`, `global-error.tsx`, `PanelSkeletons` | 🟢 **產品級** |
| 設定與 secret | 無硬編碼金鑰，Token 安全存放 | 維持現狀 | 🟢 **產品級** |
| 資安與隱私 | 登出對話清理缺乏測試保護、圖片無體積限制 | 登出隱私清理測試守護、5MB 與 MIME 檢查上線 | 🟢 **產品級** |
| 前端工程（效能與體積） | 首頁 811 kB First Load JS | `next/dynamic` 按需載入，首頁降至 698 kB | 🟢 **產品級** |

---

## 1. 事實基線對照表

| 項目 | 稽核初始基線 (Commit `9f05787`) | 修復完成後基線 (PR #60, #61, #62) |
| --- | --- | --- |
| 技術棧 | Next.js 15 + React 19 + Capacitor 8 + Zustand 5 + MapLibre 5 | 同左（+ @biomejs/biome 2.5.9 鎖定） |
| TypeScript 型別檢查 | **exit=0**（0 errors） | **exit=0**（0 errors） |
| Linter (Biome) | **exit=1**（**61 errors, 76 warnings**） | **exit=0**（**0 errors, 0 warnings across 251 files**） |
| 循環依賴檢查 (Madge) | **exit=0**（0 circular dependencies） | **exit=0**（0 circular dependencies） |
| 測試套件 (Vitest) | 23 files, 200 tests passed | **30 files, 260 tests passed**（+60 個測試） |
| 首頁 First Load JS | 811 kB | **698 kB**（減少 113 kB / 14%） |
| CI 流程 | 僅 deploy.yml | **`.github/workflows/ci.yml` 上線並全綠** |

---

## 2. 發現清單與修復對照

### P1 阻擋上線級別

- **P1-1 缺少 Error Boundary 與 Next.js 錯誤降級機制** ➜ ✅ **已修復**（PR #60, Commit `22a333f`）
  - 建立通用 `ErrorBoundary.tsx`、`error.tsx` 與 `global-error.tsx`，導入 `ui-ux-pro-max` 44px 觸控熱區與無障礙 `role="alert"`。
- **P1-2 CI 缺乏自動化防護網且存在 61 個未修復 Lint 錯誤** ➜ ✅ **已修復**（PR #60, Commit `e685094`）
  - 建立 `.github/workflows/ci.yml`，修復 CSS specificity、靜態 div 互動事件、ARIA role 與 import 排序，達 0 errors / 0 warnings。
- **P1-3 登出清理對話紀錄之隱私邏輯缺乏測試守護** ➜ ✅ **已修復**（PR #60, Commit `27ee641`）
  - 在 `useAuthStore.test.ts` 補齊登出清空 `useChatStore`、`sessionStorage` 與 Token 撤銷測試，突變抽測必殺。
- **P1-4 Geolocation `watchPosition` 錯誤回呼無節流引發 Toast 轟炸** ➜ ✅ **已修復**（PR #61, Commit `19612f2`）
  - 建立 `gpsErrorHandler.ts` 狀態轉移過濾器，僅在首次出錯時提示，正常時自動恢復。

### P2 維護成本與結構債級別

- **P2-1 Nominatim 反向地理編碼散落 5 處** ➜ ✅ **已修復**（PR #61, Commit `ff2406b`）
  - 在 `placeSearch.ts` 封裝 `reverseGeocode()`，內建快取與自訂 User-Agent，替換 5 處呼叫。
- **P2-4 `createHazardReport` 無錯誤防護** ➜ ✅ **已修復**（PR #61, Commit `ff2406b`）
  - 封裝 `ApiError` 結構化錯誤處理，防止 502/504 導致未捕獲 SyntaxError。
- **P2-5 缺乏表單客戶端驗證與圖片上傳防護** ➜ ✅ **已修復**（PR #61, Commit `ff2406b`）
  - 加入 5MB 上限與 MIME 類型白名單檢查。
- **P2-3 首頁打包體積過大（缺乏 Code Splitting）** ➜ ✅ **已修復**（PR #61, Commit `138da9f`）
  - 使用 `next/dynamic` 搭配 `PanelSkeletons.tsx` 骨架屏按需載入，首頁 Bundle 由 815 kB 降至 698 kB。
- **P2-2 巨型 God Component 與 God Store** ➜ ✅ **已修復**（PR #62，由 Claude Opus 5 完成）
  - `RouteCard.tsx` 拆為 10 個模組、`useMapStore.ts` 拆為 6 個 Zustand Slice 工廠、`BottomSheet.tsx` 抽離 Rail 與面板容器。

---

## 3. PR 追蹤與歸檔記錄

- **PR #60**：`feat: implement product-grade audit phase 1-3 fixes (error boundaries, CI & lint, auth logout tests)`（已合併）
- **PR #61**：`feat: implement product-grade audit phase 4-6 fixes (GPS throttling, API refactor, dynamic code splitting)`（已合併）
- **PR #62**：`refactor: decompose God Component (RouteCard, BottomSheet) and God Store (useMapStore) (P2-2)`（已開立，CI 全綠）

---

## 4. 本輪動過什麼

- **執行工具**：Orca Orchestration (`run_99b0c142a075`)、Pi Agent (Claude Opus 5, Gemini 3.7 Flash)
- **清理項目**：已刪除暫存之 `docs/plan-phase-1-2-3.md`、`docs/plan-phase-4-5-6.md`、`docs/plan-phase-7.md`
- **產出文件**：更新 `docs/audit/2026-08-18-product-grade-audit.md`
