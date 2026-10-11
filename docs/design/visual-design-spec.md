# 無障礙智慧地圖 — 視覺設計規範 v1.0

> 狀態：**規範定案，尚未全面實作**。本文件是「一次到位」施工的唯一依據 —
> 之後任何 UI 改動（新增功能、修 bug、換圖示）都必須先對照本文件，不再症狀式修補。
> 若本文件與現況程式碼衝突，以本文件為準，並回頭修正程式碼；若發現本文件有遺漏的情境，
> 先補文件再動工，不要跳過文件直接改 code。
>
> 基於現況程式碼盤點（2026-07-29）：`src/app/globals.css`、
> `src/components/BottomSheet/BottomSheet.tsx`、`HomeContent.tsx`、
> `src/components/Wrapper/MapControlsWrapper.tsx`、`src/components/AIChatBot.tsx`、
> `src/components/Navigation/NavigationHUD.tsx`、`src/components/ui/*-icon.tsx`（動畫圖示）。

---

## 0. 現況落差摘要（本規範要修正的具體債務）

| # | 現況 | 問題 | 本規範的對應章節 |
|---|------|------|------------------|
| 1 | `AIChatBot.tsx` 是獨立 `fixed` 卡片（z-50），`MapControlsWrapper` 另外放一顆 AI FAB 觸發它；兩者都各自用 `sidebarCollapsed`/`panelOpen` 手動算 `left` 位移來避開 Side Rail | AI 助理與搜尋/路線/地點面板是「平行的兩套浮層系統」，只靠位移閃避，未來只要面板尺寸一變就會重新互蓋 | §5 空間與層級、§6.3 AI 助理面板 |
| 2 | Side Rail 圖示顏色來自 `RAIL_ITEMS`/`QUICK_ACTION_DEFS` 裡的 `text-emerald-500`、`bg-orange-500/10`、`text-indigo-500`、`text-amber-500`、`text-sky-500`、`text-rose-500` 等散落 Tailwind 色階 | 同類語意（無障礙=emerald、警示=amber、停車=indigo…）沒有對應到 `globals.css` 的 design token，色彩系統形同虛設 | §2 色彩系統 |
| 3 | z-index 全部是就地手打的 `z-10/20/30/40/50`，同一層數字在不同檔案代表不同語意（e.g. `z-40` 同時用在 mobile sheet 容器、桌面 panel、HUD 頂部橫幅、`NavigationController`） | 沒有 scale，新功能加浮層只能用「試出來剛好蓋得住」的數字 | §5.1 z-index scale |
| 4 | Side Rail label 目前是 `t(item.labelKey)` 直接塞進 `max-w-[48px] truncate`，曾發生品牌全名溢出換行 | 沒有字數上限規則，靠 `truncate` 兜底但視覺仍會被截斷得很難看 | §3.4 Rail label 規則 |
| 5 | 「無障礙」概念視覺不一致：Side Rail logo 用純 `Accessibility` icon + `text-primary`；快捷 chip 用純色底 tint + icon；地圖上的無障礙地點目前沒有統一 pin+badge 元件 | 使用者反應「不直覺」 | §4 圖示語意系統 |

---

## 1. 設計原則

這五條不是抄大廠 Design Principle 清單，而是針對「無障礙 × 想被所有人喜歡使用」這個定位、且只有一位工程師維護的現實所寫的取捨依據。做任何視覺決策時，先問這五條，不要另外發明新原則。

1. **一個概念只有一種長相（One Concept, One Look）**
   「無障礙」「警示」「導航中」等核心語意，全 App 只能對應一組固定的顏色 + 圖示形式組合（見 §4）。不允許因為某個畫面「看起來需要別的顏色」就臨時借用 Tailwind 調色盤裡的別的色階。新增畫面時如果現有語意都不合，先回來擴充 token（§2），不要在元件裡開新色。

2. **地圖是主角，UI 是暫時的訪客**
   所有浮層（面板、HUD、控制項、對話框）都必須可以被一鍵收起看到完整地圖，且面板本身要用毛玻璃／留白降低視覺重量。任何新浮層在設計前要先確認：這個資訊「現在」是不是必須疊在地圖上，能不能延後到使用者主動點開才顯示。

3. **同一時間只服務一個任務（面板互斥）**
   搜尋、路線規劃、地點詳情、AI 助理、導航 HUD 是同一個「內容插槽」的不同模式，永遠只顯示其中之一，不會並存疊加（見 §5.2）。控制項（3D/定位/縮放/SOS/語音）是例外——它們是「任何模式下都可能要用」的常駐工具，因此永遠在最上層、且固定在畫面角落，不與內容插槽搶位置。

4. **無障礙使用者的路徑必須是最短路徑，不是隱藏路徑**
   輪椅使用者要找「附近無障礙廁所」、視障者要開語音助理、長者要放大字體或開高對比模式——這些操作的點擊步驟數，設計時要用「首頁一屏內可達」當基準去檢查，不能藏在三層選單後面。任何新功能上首頁時，要跟現有 6 個快捷 chip 比較優先序，而不是無限往「更多」裡塞。

5. **動效是回饋，不是裝飾**
   Motion（`motion/react`）只用在：狀態切換的過渡（面板開關、模式切換）、明確的使用者回饋（按下、載入中、成功/警示浮現）、以及動畫圖示的互動觸發（hover/active）。不允許為了「看起來精緻」加裝飾性動效；所有動效都要尊重 `prefers-reduced-motion`（`useReducedMotion`），這是無障礙的底線而非加分項。

---

## 2. 色彩系統

色彩全部走 Tailwind CSS 4 的 `@theme` + CSS variable（`oklch`），對應 `src/app/globals.css`。**禁止**在元件裡直接寫 Tailwind 內建色階（`emerald-500`、`amber-500`、`indigo-500`、`sky-500`、`rose-500`、`orange-500` 等）代表語意色；這些色階只能用在「使用者自訂/資料視覺化」情境（例如 `--chart-1~5` 已涵蓋的圖表用色），不能用來畫「無障礙」「警示」這類產品語意。

### 2.1 Token 清單與用途

| Token | 語意 | 目前值（light） | 何時用實心（solid） | 何時用淡色（tint，`/10~/15`） | Dark mode |
|---|---|---|---|---|---|
| `--primary` | 品牌主色／預設互動色。導航、路線規劃、搜尋、預設按鈕、Side Rail 選中狀態 | `oklch(0.546 0.245 262.881)`（≈ tailwind blue-600） | 主要 CTA 按鈕（規劃路線、送出）、Side Rail 選中指示條、連結文字 | Rail 按鈕 hover/選中底色（`bg-primary/10`）、次要強調背景 | `oklch(0.707 0.165 254.624)`（≈ blue-400，深色需要更亮以維持對比） |
| `--accessibility`（**新增**） | 「無障礙」語意專用色，橙色系，取代目前散落的 emerald/orange | `oklch(0.72 0.17 55)`（≈ tailwind orange-500，最終數值以實測對比為準） | Side Rail logo 底色圓形（純色底+輪椅）、地圖上無障礙 pin 徽章底色、A11y 面板的標題 icon | 快捷 chip 未選中時的底色 tint（`bg-accessibility/10`）、無障礙設施列表項目的左側色條 | 提高亮度與飽和以維持在深色底上的可讀性，比照 `--primary` 的 dark 調整邏輯 |
| `--alert`（**新增**） | 一般性警示（迷路、設施提醒、資料落差），非緊急，橙黃色系 | `oklch(0.79 0.16 85)`（≈ tailwind amber-500） | 導航中的「偏離路線」「步行指引缺失」提示條、地圖上的通報中危險點 | 提示卡片底色 tint、待處理狀態徽章 | 同色相提高亮度，深色底維持文字對比 ≥ 4.5:1 |
| `--destructive` | 緊急／不可逆／需要立即注意（SOS、刪除、嚴重錯誤） | `oklch(0.577 0.245 27.325)`（≈ tailwind red-600） | SOS 按鈕、刪除確認、嚴重錯誤訊息 | 錯誤欄位邊框（`border-destructive/50`） | `oklch(0.704 0.191 22.216)` |
| `--primary-foreground` / `--accessibility-foreground` / `--alert-foreground` / `--destructive-foreground` | 對應色塊上的文字/圖示色 | 各自的高對比前景色 | 實心底色上一律用 foreground token，不手動判斷黑白 | 同上 | 隨底色調整，維持 WCAG AA |
| `--muted` / `--muted-foreground` | 次要資訊、輔助文字、非互動裝飾 | 既有值不變 | 說明文字、時間戳、次要 icon | 卡片內底色分隔區塊 | 既有 dark 值 |
| `--border` | 面板/卡片邊框，統一走半透明（`/50`）搭毛玻璃 | 既有值不變 | 所有 `rounded-2xl` 卡片外框 | — | 既有 dark 值（`oklch(1 0 0 / 10%)`） |
| `--chart-1`〜`--chart-5` | 僅限資料視覺化（環境數據圖表、AQI 曲線等），**不得**挪用為語意色 | 既有值不變 | 圖表資料序列 | 圖表區域填色 | 既有 dark 值 |
| High-contrast 模式（`.high-contrast`） | 長者/低視力使用者手動開啟 | 既有 `--background: oklch(0.05 0 0)` 等 | 所有 token 全部走這組覆寫，元件不用另外判斷 | 同上 | 已是深色系統，不再疊加一般 dark mode |

### 2.2 語意色對應表（拍板決策，不可再改用其他色階）

| 語意 | Token | 使用場景舉例 |
|---|---|---|
| 無障礙 / 復康巴士 / 無障礙計程車 / 電梯坡道 | `--accessibility` | Side Rail「無障礙設施」項目、搜尋快捷 chip、A11y 面板、地圖 pin 徽章、導航中「前方無障礙設施」提示 |
| 公車/捷運等大眾運輸 | `--primary`（不另開新色；若未來需要區分，先提案擴充再動工，不得臨時借 emerald） | Side Rail「公車動態」項目、BusPanel |
| 停車（一般/身障車位） | `--primary` 搭配中性 icon（`CircleParking`），不使用 indigo | ParkingPanel、快捷 chip |
| 一般提醒/待確認/資料缺失 | `--alert` | 導航「偏離路線」條、「步行指引無資料」警告、通報中危險點 pin |
| 緊急/SOS/刪除 | `--destructive` | SOS 按鈕、退出導航確認 dialog 的危險選項 |
| 環境/空氣品質（多階分級） | 沿用既有 `LEVEL_CONFIG` 六階漸層（green→yellow→orange→red→purple→rose），**僅限**空氣品質這一個情境例外允許多色階，因為它本身就是政府 AQI 六級標準色，不算「臨時色階」 | 空氣品質徽章、EnvironmentPanel |
| 收藏/個人化 | `--primary`（星號/書籤用 primary，不使用 amber） | SavedPlacesPanel、Bookmark icon |

### 2.3 深色模式與高對比模式規則

- 一般 dark mode：所有 token 走 `.dark` class 覆寫，元件永遠用語意 token，不寫 `dark:text-xxx-400` 這種手動雙軌（現況 `MapControlsWrapper.tsx` 的 `LEVEL_CONFIG` 手寫 `dark:` 類是空氣品質六階的唯一例外，其餘元件不得比照）。
- 高對比模式是無障礙核心功能，優先權高於一般美觀考量：`.high-contrast` 底下所有互動元素邊框強制 2px、字重強制 500 起跳，這條規則已存在於 `globals.css`，新元件不得寫死邊框寬度/字重覆蓋掉它。

---

## 3. 文字與排版

字型：`--font-sans`（Geist Sans + Noto Sans TC），中英混排一致，不額外引入其他字體。

### 3.1 字級／字重階層

| 用途 | class | 字級/行高 | 字重 | 範例 |
|---|---|---|---|---|
| 面板/頁面主標題 | `text-base font-bold` | 16px / 1.25 | 700 | Mobile sheet header「無障礙智慧地圖」 |
| 面板次標題（Panel header） | `text-sm font-bold` | 14px / 1.3 | 700 | 桌面 Layer 2 panel header |
| 分區標題（section heading） | `text-sm font-semibold text-muted-foreground` | 14px / 1.3 | 600 | 「快捷功能」「已儲存地點」 |
| 內文/列表主要文字 | `text-sm` | 14px / 1.4 | 400（強調處 500） | 地點名稱、訊息內容 |
| 輔助/次要文字 | `text-xs text-muted-foreground` | 12px / 1.4 | 400 | 地址、時間戳、說明句 |
| 極小標籤（badge/計數） | `text-[10px]`〜`text-[11px]` | 10–11px | 500–600 | Metric 標籤、Badge 徽章 |
| 導航 HUD 巨大數字 | `text-4xl font-black tabular-nums` | 36px | 900 | 前方距離「50 公尺」 |
| 按鈕文字（標準） | `text-sm font-semibold` | 14px | 600 | 一般 CTA |
| 按鈕文字（強調 CTA） | `text-sm font-bold` | 14px | 700 | SOS、結束導航 |

規則：正文最小可視字級為 `text-xs`（12px），**不得**再更小（現有 `text-[9px]` 的 Rail label 是唯一允許的例外，原因見 §3.4）；高對比模式下所有字重自動 +100〜+200（由 `.high-contrast` 全域規則處理，元件不必手動判斷）。

### 3.2 中文字數限制規則

| 位置 | 上限 | 說明 |
|---|---|---|
| Side Rail label（桌面圖示下方文字） | **2–4 個中文字** | 例：「搜尋」「無障礙」「公車」「停車」「收藏」「通報」。禁止塞入品牌名稱或完整句子（品牌全名只出現在 mobile header 與 AI 助理面板標題，不出現在 Rail） |
| 快捷 chip 文字 | **2–6 個中文字** | 例：「捷運無障礙」「通報障礙」「停車資訊」 |
| 面板/頁面標題 | **≤ 10 個中文字** | 例：「無障礙設施」「路線規劃」 |
| 按鈕文字 | **≤ 6 個中文字** | 例：「開始導航」「重新規劃」 |
| Toast / 提示訊息單行 | **≤ 18 個中文字**，超過需換行或改用面板呈現 | — |

### 3.3 行高與截斷

- 多行內文一律 `line-clamp-2`（現況 `AIChatBot` 已用在訊息泡泡，維持）；單行必斷字用 `truncate`，避免 `truncate` 前先確認容器 `min-w-0`（現況 bug 常見於 flex 子元素忘記加 `min-w-0` 導致 truncate 失效）。
- Rail label 的 `max-w-[48px] truncate` 是「上限保護」不是「設計依據」——文案本身必須先符合 §3.2 的字數規則，`truncate` 只防止翻譯字串意外過長時的最壞情況。

### 3.4 Rail label 規則（對應現況落差 #3, #4）

- 字級固定 `text-[9px]`，`leading-none font-medium`，`mt-0.5` 與 icon 保持 2px 視覺間距。
- 容器寬度 `max-w-[48px]`，按鈕總寬 `w-11`(44px)、高 `h-11`。
- 文案來源（i18n key）必須先過 2–4 字檢查，PR/實作前用 §7 驗收清單第 1 條檔。
- 若某功能的自然中文名稱超過 4 字（例如「復康巴士叫車」），Rail label 用簡稱（「叫車」），完整名稱只出現在該功能自己的面板標題與 `aria-label`（螢幕閱讀器仍讀完整語意，視覺上簡化）。

---

## 4. 圖示語意系統

三種形式，各自對應明確情境，不可混用：

### 4.1 純圖示（Plain Icon）

**定義**：單一 lucide-react 或動畫圖示元件，套用語意色（`text-primary` / `text-accessibility` / `text-alert` / `text-destructive`），無底色、無徽章、無 pin。

**使用時機**：出現在「文字旁邊的輔助標示」——面板標題前綴、按鈕內圖示、列表項目 icon、Metric 卡片圖示。

### 4.2 徽章組合（Badge Composition：pin + icon 或 icon + badge）

**定義**：兩個圖形元素疊加，通常是「容器（pin/圓形底）+ 語意 icon」，代表「地圖上的一個實體地點/物件」。

**使用時機**：只在「代表地圖上一個可定位的東西」時使用——地圖上的無障礙設施 pin、搜尋結果卡片的地點類型標示、快捷 chip 裡代表「去到地圖上找無障礙地點」的動作。**不可**用在單純的面板標題或按鈕（那些用純圖示即可，加 pin 底反而暗示「這是地圖上一個點」，造成誤導）。

### 4.3 動畫圖示（Animated Icon，`src/components/ui/*-icon.tsx`）

**定義**：`motion/react` 驅動、hover/active 觸發微動畫的圖示元件（目前已有 `accessibility-icon.tsx`、`map-pin-icon.tsx`、`mic-icon.tsx`、`triangle-alert-icon.tsx`）。內建 `useReducedMotion` 保護。

**使用時機**：只用在「使用者主動觸發、且該次互動是這個畫面的核心動作」的**唯一入口點**——例如 Side Rail 最頂端的品牌 Logo（引導使用者認識這是「無障礙」App）、語音輸入按鈕（按下前 hover 提示「這是麥克風」）、導航中新出現的危險警示卡片（第一次出現時播放一次強調動畫，之後靜止）。**不可**在列表中重複使用（例如 10 筆無障礙設施列表，每個都放動畫圖示會變成視覺噪音，此時應退回 §4.1 純圖示）。

### 4.4 具體場景對照表（拍板決策）

| 場景 | 形式 | 理由 |
|---|---|---|
| Side Rail 頂部 Logo | **動畫圖示**（`AccessibilityIcon`，hover 觸發），純色圓底 + `text-primary` | 品牌識別的單一入口，值得用動效建立記憶點；純色圓底而非橙色，因為這是「品牌」不是「無障礙資料語意」——與下面的 chip 區分開 |
| 搜尋欄「無障礙設施」快捷 chip | **徽章組合**：pin 造型底 + 輪椅 icon，底色 `bg-accessibility/10`，icon `text-accessibility` | 代表「地圖上的無障礙地點集合」，pin 形狀強化「按下去會在地圖上顯示點位」的預期 |
| A11y 面板 / 列表項目 icon | **純圖示**，`text-accessibility` | 面板內是清單而非地圖標示，避免同畫面出現過多 pin 造型互相干擾 |
| 導航警示卡片（偏離路線／危險通報首次出現） | **動畫圖示**（`TriangleAlertIcon`）僅首次出現播放一次，之後同一張卡片保持靜止純圖示 | 需要在使用者視線可能不在畫面時間短暫抓住注意力，但持續動畫在導航中會分散對路況的注意力（無障礙使用者尤其是長者/認知负荷考量） |
| 語音輸入按鈕（AI 助理 / 語音導航） | **動畫圖示**（`MicIcon`），idle 不動、hover 預覽動畫、錄音中另有獨立的錄音態動畫（非本圖示系統範疇，屬狀態指示） | 這是視障使用者的核心操作入口，動效輔助建立「這是可互動麥克風」的即時回饋 |
| 地點詳情頁的無障礙標籤（「有輪椅坡道」「有無障礙廁所」） | **徽章組合**：小圓底 + icon，`bg-accessibility/10` 底 + `text-accessibility` icon，非 pin 形狀（用簡單圓形即可，因為此處不代表地圖座標） | 代表「這個地點具備的無障礙屬性」，用徽章而非純圖示以在密集資訊列表中提高視覺辨識度；不用 pin 形狀因為它不是地圖上的另一個獨立地點 |
| Side Rail 一般功能項目（公車/停車/收藏/通報等） | **純圖示** | 是導覽項目而非地圖地點標示或核心品牌動作 |

---

## 5. 空間與層級

### 5.1 z-index scale

新建 `--z-map` / `--z-controls` / `--z-panel` / `--z-dialog` 四層 CSS variable（或對應 Tailwind class 命名慣例 `z-map` / `z-controls` / `z-panel` / `z-dialog`），**取代**目前程式碼裡就地手寫的 `z-10/20/30/40/50` 數字。

| 層級 | Token | 數值建議 | 內容 | 原因 |
|---|---|---|---|---|
| Layer 0：地圖本體 | `z-map` | `0` | MapLibre canvas、路線線條、地圖上的 marker/pin | 最底層，一切浮層都疊在它之上 |
| Layer 1：地圖疊加資訊 | `z-map-overlay` | `10` | NowPin、路線線條圖層 wrapper、公車即時位置疊圖 | 這些是「畫在地圖座標系上」的視覺，邏輯上比地圖本體高一級，但仍是地圖的一部分而非 UI 面板 |
| Layer 2：內容面板（互斥插槽） | `z-panel` | `20` | Bottom Sheet（mobile）／Side Rail 內容面板（desktop Layer 2）、搜尋/路線/地點/AI 助理/導航步驟列表——這些互斥共用同一層 | 這一層彼此互斥（見 §5.2），不需要互相比大小，統一同層即可 |
| Layer 3：常駐控制項 | `z-controls` | `30` | 右下角地圖控制項群（3D、定位、SOS、分享、語音）、環境資訊藥丸、Side Rail 圖示列本身 | **必須**高於 Layer 2：控制項是「任何模式下都要能點到」的常駐工具，不能被任何內容面板蓋住——這正是本規範要解決的落差 #1 的根本原因 |
| Layer 4：Modal / Dialog / Toast | `z-dialog` | `50` | shadcn `Dialog`、`DropdownMenu`、`Popover`、`Select`、SOS 確認彈窗、退出導航確認、Toast 通知 | 全域阻斷式互動，永遠最上層 |

**強制規則**：
- Layer 3（控制項）必須高於 Layer 2（面板），因為控制項是跨模式共用工具列，若被任一面板蓋住，使用者在該面板開啟時就失去定位/求救等關鍵能力——這是不可接受的無障礙風險，尤其 SOS 按鈕在任何情況都必須可觸及。
- 新增任何浮層元件時，第一步是判斷它屬於上述哪一層，直接用對應 token，**禁止**手寫數字或「試出來能蓋住鄰居就好」的做法。
- 若同層內有多個元件需要互相比較（例如 Layer 2 內展開的子選單），用相對定位（`relative`/`absolute` 配合父層 stacking context）處理，不要跳去更高的 z-index token。

### 5.2 面板互斥規則（對應落差 #1）

「內容插槽」同一時間只能顯示一種模式，以下全部視為同一個互斥集合的成員：

`搜尋首頁 | 無障礙設施 | 公車動態 | 停車資訊 | 已收藏 | 通報障礙 | 更多（環境/福利/路線） | 地點詳情 | 路線規劃 | 路線結果 | 導航步驟列表 | AI 助理`

- 開啟其中一個，其餘必須關閉（現況 `sheetMode`/`activeRailPanel` 的 `MODE_PANELS` 互斥邏輯是正確方向，**AI 助理必須併入同一個狀態機**，而不是用獨立的 `chatOpen` boolean 平行存在）。
- 導航模式（`isNavigating`）啟動時，整個內容插槽讓位給 `NavigationHUD`，只留一個「展開步驟列表」的入口把插槽叫回來（現況已如此，維持）。
- 常駐控制項（Layer 3）不受此互斥規則約束，任何模式下都顯示（導航模式下控制項精簡為語音/定位/SOS，其餘收合，現況邏輯維持）。
- AI 助理併入互斥插槽後的具體要求：桌面版比照 Layer 2 面板同一個 380px 容器換內容，不再是獨立 `fixed` 卡片；行動版比照 Bottom Sheet 的 `sheetMode` 新增 `"chat"` 值，而非另一個 `open` state。

### 5.3 圓角 / 陰影 /間距 scale

| Token | 值 | 用途 |
|---|---|---|
| `rounded-xl`（`--radius-md`） | ~10px | 按鈕、chip、小卡片 |
| `rounded-2xl`（`--radius-lg`，`--radius: 0.75rem`） | 12px | 面板、Bottom Sheet 頂角、對話框、控制項的容器卡片 |
| `rounded-3xl` | 24px | Bottom Sheet 頂部（現況 `rounded-t-3xl`，維持） |
| `rounded-full` | — | 圖示按鈕、頭像、藥丸型標籤、SOS/FAB 按鈕 |
| 陰影：`shadow-sm` | 列表項目 hover、次要卡片 |
| 陰影：`shadow-lg` | 常駐控制項按鈕（Layer 3） |
| 陰影：`shadow-xl` / `shadow-2xl` | 面板（Layer 2）、對話框（Layer 4）、Bottom Sheet |
| 間距：組件內 padding | `p-3`（12px）小型、`p-4`（16px）標準面板、`p-5`（20px）強調卡片（HUD 頂部橫幅） | 一致採 4px 倍數 |
| 間距：元素間 gap | `gap-1.5`〜`gap-2`（icon 與文字）、`gap-2`〜`gap-3`（列表項目/按鈕群） | — |
| 觸控目標最小尺寸 | `44×44px`（`h-11 w-11`） | 所有可點擊按鈕（含 Rail 項目、控制項、chip）不得小於此值——WCAG 2.5.5 的無障礙硬性下限 |

---

## 6. 核心元件規格

### 6.1 Side Rail（桌面，Layer 3 容器 + 內含 Layer 2 觸發器）

- 尺寸：固定寬 `56px`（`w-[56px]`），高度 `fixed top-3 bottom-3 left-3`，永遠貼齊左側，`z-controls`。
- 背景：`bg-background/95 backdrop-blur-md`，`border border-border/50`，`rounded-2xl`，`shadow-xl`。
- 內部結構（由上至下）：Logo（動畫圖示，`h-12 w-12` 容器）→ 分隔線 → 主要項目（最多 6 個，`h-11 w-11` 按鈕）→ 分隔線 → 「更多」→ 彈性空間 → 帳號登入。
- 狀態：
  - **Default**：`text-muted-foreground`，無底色。
  - **Hover**：`hover:bg-muted`，`hover:text-foreground`。
  - **Active（選中）**：`bg-primary/10 shadow-sm`，icon 套語意色（非全部 primary，依 §4 語意表），左側 `3px` 高亮條（`motion.div layoutId` 動畫，現況已有，維持）。
  - **Disabled**（例如導航中隱藏）：整個 Rail `hidden`，不做半透明 disabled 態（導航時控制權完全交給 HUD）。
  - **Focus-visible**：`outline-2 outline-primary outline-offset-2`，鍵盤可達（`aria-pressed`/`aria-label` 現況已具備，維持）。
- Label：見 §3.4。

### 6.2 Bottom Sheet 三態（行動版）

- 三個 snap 高度：`peek = 12dvh`、`half = 45dvh`、`full = 92dvh`（現況 `SNAP_POINTS` 數值維持）。
- 容器：`bg-background rounded-t-3xl shadow-2xl border-t border-border/50`，`z-panel`。
- 拖曳把手：`w-10 h-1 rounded-full bg-muted-foreground/30`，觸控區域含把手上下需 `≥44px` 高（目前 `py-3` 手把容器需檢查是否達標，見 §7）。
- 狀態切換動畫：`spring stiffness:300 damping:30`（現況維持），拖曳中不套用 spring（`isDragging` 時关闭 animate，維持現況邏輯）。
- 三態使用時機：
  - `peek`：導航模式常駐（只留 ETA 摘要），或任何模式下使用者手動收合到最小。
  - `half`：預設模式（搜尋、面板、地點詳情、路線結果）。
  - `full`：使用者主動拖到底，或內容過長需要更多可視高度（例如展開的路線步驟列表）。
- **AI 助理併入此元件後**：`sheetMode` 新增 `"chat"`，預設落在 `half`，不再是獨立 `Card`。

### 6.3 AI 助理面板（併入互斥插槽，取代目前獨立浮動卡片）

- 桌面：作為 Layer 2 內容面板的一種模式，套用與其他面板相同的 380px 容器、header 樣式（icon + 標題 + 關閉鈕），**不再自帶** `Card`/`fixed`/自算 `left` 位移。
- 行動版：作為 `sheetMode = "chat"` 的內容，遵循 Bottom Sheet 三態。
- 觸發入口：Layer 3 常駐控制項的 AI FAB（`bg-primary` 圓形按鈕，`BotMessageSquare` 純圖示——不用動畫圖示，因為此按鈕在多數畫面持續可見，動畫圖示應保留給語音按鈕與 Logo 這種「單一入口」）。
- 對話氣泡、工具結果卡片、語音模式（`VoiceModeView`）等內部細節維持現況實作，僅外層容器改為插槽模式。
- 狀態：
  - 開啟中：插槽顯示 AI 助理內容，Rail 對應「無」高亮（AI 助理不是 Rail 項目，是獨立於 Rail 之外、由 Layer 3 FAB 觸發的插槽模式，允許與任何 Rail 項目同時「記住」但不同時顯示——即關閉 AI 助理後應回到使用者離開前的 Rail 面板，而非強制回首頁）。
  - Loading：`ThinkingIndicator`（現況實作維持）。
  - 語音會話中：`showVoiceMode` 切換到 `VoiceModeView`（現況維持）。

### 6.4 快捷 Chips（HomeContent 首頁）

- 形狀：`rounded-full`，`px-3 py-2`，`text-sm font-semibold`，icon `h-4 w-4` + 文字，`gap-1.5`。
- 顏色：**全部改為語意 token**——無障礙相關 chip 用 `bg-accessibility/10 text-accessibility hover:bg-accessibility/20`；一般提醒類（通報障礙）用 `bg-alert/10 text-alert`；其餘（公車、停車、環境、福利）**不再各自配色**，統一用 `bg-primary/10 text-primary hover:bg-primary/20`（現況每個功能各配一色是造成「色彩系統形同虛設」的主因，必須收斂）。
- 自訂模式（`editingActions`）：選中態 `ring-2 ring-primary/40` 疊加原底色（維持現況機制，但底色改用上述收斂後的語意色）。
- 橫向捲動＋snap（現況 `overflow-x-auto no-scrollbar snap-x snap-mandatory` 維持），「更多」展開後改為 `flex-wrap`（現況維持）。
- 觸控目標：整顆 chip 高度需 `≥44px`（目前 `py-2` + 文字約 36px，需在實作時量測補足，見 §7）。

### 6.5 警示卡片（導航 HUD / 通報提示）

- 一般警示（`--alert`）：`bg-alert/95 text-alert-foreground`（現況 `bg-amber-500/95` 需改為 token），`rounded-2xl shadow-lg`，icon + 文字 + 可選操作按鈕（如「重新規劃」），操作按鈕用半透明白底 `bg-white/25 hover:bg-white/35`（維持現況質感，僅色源改 token）。
- 緊急/不可逆（`--destructive`）：SOS 相關維持 `bg-red-500`→改用 `bg-destructive`；hold-to-trigger 的圓形按鈕動效（`scale:1.15` 倒數態）維持現況實作。
- 首次出現用動畫圖示（見 §4.4），出現動畫 `initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}`（現況 `AnimatePresence` 用法維持），退場同樣淡出。
- 導航中的接近提醒 pill（`facilityAlert`/`hazardAlert`）：無障礙設施用 `bg-accessibility/10`+`text-accessibility`（現況 `bg-green-100/95`+`text-green-800` 需改為 token）；危險提醒用 `--alert` token（現況 `bg-amber-100/95` 需改為 token）。

---

### 6.6 地圖障礙回報卡片（2026-10-11）

- 順序：回報類型與影響程度 → 回報描述 → 現場照片 → 照片審核狀態／可展開的審核說明 → 社群票數與操作。
- 浮窗最大寬 336px，窄螢幕預留右側 72px 給地圖控制項與 SOS、左側至少 16px；桌機另避開左側 Rail。最大高度 640px，桌機不超過視窗扣除 100px，手機避開底部 peek sheet，內容可垂直捲動。採底部錨點，開啟／內容尺寸改變／視窗縮放時自動平移地圖以避免卡片截斷；不攔截使用者手動平移。
- 卡片使用既有 `popover`、`foreground`、`muted`、`primary` token 與原字型，不新增色彩或字型；主標題／描述 16px，其他正文 14px，輔助標籤至少 12px。
- 標題列含內容安全選單與 44px 關閉鈕；確認／否認採兩欄、最小 44px 高，具鍵盤焦點與請求中禁用狀態，不以亮綠／灰底小藥丸暗示真假。
- 有照片的回報必須使用 `HazardReportPhoto`，透過後端受保護的 bytes endpoint 取得 Blob；不可直接顯示 `photoUrl`。舊資料的 URL 只作存在判斷，`hasPhoto: false` 優先。照片 16:9 框採 contain，保留載入中、失敗、重試與替代文字。
- 照片支持回報與現地獨立核實仍須明確區分。自己的回報、已投票、過期與不可確認狀態沿用現有規則。

---

## 7. 驗收檢查清單

給 nav-dev 實作完、nav-review 審查用，逐條可打勾，不接受「看起來還可以」這種主觀判斷。

### 7.1 色彩

- [ ] 全專案搜尋 `emerald-|amber-|indigo-|sky-|rose-|orange-` 等語意色類別，確認只出現在 §2.2 明列的「空氣品質六階」例外情境，其餘全部替換為 `--primary` / `--accessibility` / `--alert` / `--destructive` token
- [ ] `globals.css` 已新增 `--accessibility`、`--alert`（含對應 `-foreground`），並在 `.dark` 與 `.high-contrast` 都有對應覆寫值
- [ ] 所有語意色文字/圖示在各自底色上的對比度 ≥ WCAG AA（一般文字 4.5:1，大字/icon 3:1），light / dark / high-contrast 三種模式都需各自檢查（可用瀏覽器 devtools contrast checker）
- [ ] 快捷 chip 顏色收斂至 §6.4 規則，無各功能各配一色的情況

### 7.2 文字排版

- [ ] Side Rail 所有 label 為 2–4 個中文字，無任何一個需要靠 `truncate` 才能顯示完整（即字數本身合規，`truncate` 只是保護網）
- [ ] 快捷 chip 文案 2–6 字、面板標題 ≤10 字、按鈕文案 ≤6 字（抽查 i18n 檔案逐條核對）
- [ ] 所有可能溢出的 flex 子元素（label、地點名稱等）容器有 `min-w-0`，`truncate` 實際生效（用瀏覽器縮窄視窗手動驗證，不能只看程式碼）
- [ ] 高對比模式開啟後，所有互動元素邊框可見（2px）、字重明顯加粗，且無任何文字被邊框壓縮到換行/溢出

### 7.3 圖示語意

- [ ] Side Rail Logo 為動畫圖示（hover 觸發一次性動畫），非其他 Rail 項目誤用動畫圖示
- [ ] 搜尋快捷 chip 中「無障礙設施」使用 pin+輪椅徽章組合，其餘功能 chip 使用純圖示（不誤用徽章組合）
- [ ] 地點詳情頁的無障礙屬性標籤使用小圓底徽章（非 pin 形狀），與地圖上的無障礙 pin 視覺可區分但語意色一致（都用 `--accessibility`）
- [ ] 導航警示卡片動畫圖示只在該卡片首次出現時播放，卡片存續期間不循環播放（避免導航中持續分心）
- [ ] 列表/多筆重複項目（如無障礙設施清單）一律用純圖示，未出現逐項動畫圖示

### 7.4 空間與層級

- [ ] 全專案 z-index 改用 `z-map` / `z-map-overlay` / `z-panel` / `z-controls` / `z-dialog` 命名 token，無殘留就地手寫的 `z-10/20/30/40/50` 裸數字（`ui/` 內 shadcn 元件庫的 `z-50` 對話框類可維持但需對應到 `z-dialog` 語意，或明確在文件中排除說明）
- [ ] 開啟任一內容面板（搜尋/AI 助理/路線/導航步驟列表等）時，右下角常駐控制項（3D、定位、SOS、語音、分享）始終可見且可點擊，實測至少涵蓋：桌面 + 面板展開、行動版 + Bottom Sheet `full` 態
- [ ] AI 助理已併入互斥插槽狀態機（`sheetMode`/`activeRailPanel` 同一機制），開啟 AI 助理會關閉其他面板，反之亦然；不存在 AI 助理與其他面板同時可見的畫面
- [ ] 所有可點擊區域（按鈕、chip、Rail 項目）觸控尺寸實測 ≥ 44×44px（含 padding，用 devtools 量測 bounding box，不能只看 class 名稱猜測）

### 7.5 核心元件狀態

- [ ] Side Rail 每個項目的 default / hover / active(選中) / focus-visible 四態視覺皆與 §6.1 一致，鍵盤 Tab 可依序到達且有可視 focus ring
- [ ] Bottom Sheet 三態切換動畫流暢（spring，無跳動），拖曳中即時跟手、放開後正確 snap 到最近的一態
- [ ] 警示卡片（一般 `--alert` / 緊急 `--destructive`）在三種主題模式下颜色与文字对比皆合规
- [ ] SOS 按鈕 hold-to-trigger 的倒數視覺與觸發時機在導航模式與一般模式下行為一致

### 7.6 無障礙（螢幕閱讀器 / 鍵盤 / reduced motion）

- [ ] 所有圖示按鈕具備 `aria-label`，狀態切換按鈕（Rail、開關類）具備 `aria-pressed` 或 `aria-expanded`
- [ ] 面板容器有 `role="region"` 或等效語意標記與 `aria-label`（現況 desktop panel 已具備，需確認新增的 chat 模式沿用）
- [ ] 動畫圖示與所有 motion 動效在 `prefers-reduced-motion: reduce` 下降級為無動畫或極簡淡入淡出，不強制播放位移/旋轉動畫
- [ ] 高對比模式與一般模式下，Tab 順序符合視覺順序，不因為 z-index 分層導致 focus 跳到被遮蔽的元素

---

## 8. 優先級建議

實作應分批次到位，每一批完成即是一個可獨立驗收、可獨立部署的階段，避免又回到「一次改一個小地方」：

1. **P0 — 色彩 token 與 z-index scale 基礎建設**（§2、§5.1）
   理由：所有其他元件規格都依賴這兩個底層系統；不先做，後面元件改版會做兩次工。且 z-index 混亂是目前唯一會直接造成「功能不可用」（控制項被蓋住點不到）的問題，優先級最高。

2. **P1 — AI 助理併入互斥插槽 + 面板互斥規則落地**（§5.2、§6.3）
   理由：這是本次浮層互蓋問題的根源，且涉及狀態管理重構（`chatOpen` 併入 `sheetMode`），越晚做重構成本越高。

3. **P1 — Side Rail 與快捷 chips 視覺/文字規則**（§3.4、§4.4、§6.1、§6.4）
   理由：使用者已明確反應「不直覺」，且 label 溢出是實際發生過的 bug，直接影響「人人喜歡」這個定位的第一印象（Side Rail 是桌面版任何操作的必經之地）。

4. **P2 — 警示卡片與圖示語意系統全面套用**（§4、§6.5）
   理由：功能正確性不受影響（現況警示卡片能用），但屬於「拼裝感」的視覺根源，建議與 P1 同批次或緊接其後處理，避免分開改造成兩次視覺不一致的過渡期。

5. **P2 — 驗收清單全面跑過一次**（§7）
   理由：作為每個批次收尾的把關，但完整六大類清單建議在 P1 全部完成後統一跑一輪整體回歸，而非每個小改動都重新跑一次全清單（效率考量），小改動仍需跑對應章節的子清單。
