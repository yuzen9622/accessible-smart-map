# taipei-accessible-map

<div align="center">
  <img src="./public/logo.png" alt="Taipei Accessible Map Logo" width="280"/>

  ### 臺北無障礙導航系統 · Taipei Accessible Navigation System

  [![CI](https://img.shields.io/github/actions/workflow/status/yuzen9622/taipei-accessible-map/ci.yml?branch=main&label=CI&logo=github)](https://github.com/yuzen9622/taipei-accessible-map/actions/workflows/ci.yml)
  [![Next.js](https://img.shields.io/badge/Next.js-16_(Turbopack)-black?logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?logo=tailwindcss)](https://tailwindcss.com/)
  [![Capacitor](https://img.shields.io/badge/Capacitor-iOS_%7C_Android-119EFF?logo=capacitor)](https://capacitorjs.com/)
  [![Tests](https://img.shields.io/badge/Vitest-700+_passed-6E9F18?logo=vitest)](https://vitest.dev/)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE.md)

  <p>♿ 專為行動不便族群、輪椅使用者與高齡長者打造的智慧無障礙導航平台 🚶‍♂️</p>

  [🌐 線上即時體驗](https://map.yuzen.dev/) · [📖 部署文檔](./docs/deployment.md) · [👥 開發團隊](#-開發團隊與致謝) · [English Summary](#-english-summary)
</div>

---

## 🎯 核心使命與痛點解決

| 面向 | 現況與痛點 (The Pain) | 本系統的解方與成效 (The Solution & Result) |
| :--- | :--- | :--- |
| **路徑規劃** | 一般地圖常引導至天橋、地下道、陡峭階梯或高低差人行道，輪椅與推車使用者寸步難行。 | **無階梯友善避障規劃**：演算法優先引導平整人行道、斜坡與電梯通道，徹底避開階梯與不可跨越路障。 |
| **捷運設施** | 抵達站點才發現該出入口無電梯或正在維修，繞路耗時且增加危險。 | **捷運全線無障礙圖資**：完整標記全線各站無障礙電梯、輪椅升降設備、專用出入口及無障礙廁所位置。 |
| **公車動態** | 班次資訊零散，無法即時確知是否為低地板公車及精確到站時間。 | **TDX 即時交通串接**：即時掌握低地板公車到站倒數、支線班次與時刻表，大幅減少候車不確定性。 |
| **臨時路障** | 施工、路面破損等突發狀況無法即時得知。 | **社群障礙回報 (Hazard Reporting)**：支援照片驗證、嚴重度分級與社群投票機制，即時更新全城路況。 |

> **最終目標**：打造真正落實「**平等出行權**」的智慧導航平台，讓每位使用者都能安心、自主地探索城市。

---

## ✨ 核心特色與功能

### 🗺️ 1. 智慧無障礙路線規劃 (Accessible Routing)
- **多維度避障權重**：優先規劃含有電梯、無障礙坡道與友善人行道的路線，主動排除人行天橋、地下道與階梯路段。
- **單一負責人本地重新規劃 (Single-Owner Local Reroute)**：當使用者偏離路線時，由本機協調器即時計算最新路廊與轉向建議，避免重複發出多餘 API 請求。
- **行車路況疊加 (Drive Traffic Overlay)**：即時呈顯道路擁擠程度與突發交通事故通知。

### 🚇 2. 捷運與公共設施無障礙圖資 (Metro & Facility A11y)
- **視覺化聚合標記 (Supercluster)**：高效能聚合標記台北捷運各站設施點位，放大時精確展開無障礙電梯、出入口與輪椅昇降設備。
- **身障友善停車與廁所引導**：提供周邊無障礙停車位現況與各站專用無障礙廁所位置。

### 🚌 3. TDX 即時大眾運輸動態 (Real-time Transit)
- **低地板公車即時到站倒數**：串接交通部 TDX 開放資料，動態更新站牌公車預估到站時間（ETA）與未發車狀態。
- **支線解析與智慧快取**：自動解析公車正副支線資訊，並內建請求去重記憶體快取（Deduplicated In-Memory Cache），兼顧速度與節流。

### 🧭 4. 沉浸式 Turn-by-Turn 導航體驗 (Navigation HUD)
- **動態 Navigation HUD**：提供清晰的轉向動作指引（Maneuver guidance）、剩餘距離里程計（`NavDistanceTicker`）與預估抵達時間。
- **相機平滑追蹤與指南針穩定**：具備 Continuous Camera Follow Loop 與 Compass Smoothing 演算法，隨使用者行進方向自然平滑旋轉地圖。

### 🤖 5. AI 智慧出行助理 & 語音導航 (AI Assistant & Voice)
- **思考軌跡與即時串流**：內建自然語言問答助理，搭載 `ThinkingTrace` 思考狀態呈顯與 `StreamingMarkdown` 串流渲染，能回答周邊無障礙設施與出行建議。
- **雙向語音互動**：支援語音輸入與語音導航播報，具備靜音控制與斷線重連自動復原（`nav.resume`）機制。

### ⚠️ 6. 社群路況與障礙通報 (Crowdsourced Hazard Reporting)
- **嚴重度分級與照片驗證**：使用者可上傳現場照片回報突發路障、施工或電梯故障，並標註嚴重度等級。
- **社群互助投票認證**：其他用路人可對通報點進行確認投票，形成動態自淨的即時路況網。

### 📱 7. 跨平台行動原生體驗 (Capacitor iOS & Android)
- **雙平台原生打包**：使用 Capacitor 封裝原生 iOS 與 Android 應用，支援背景前景生命週期感測、GPS Fix 自動刷新與防鍵盤彈起縮放優化。
- **SOS 緊急定位求助**：一鍵獲取目前高精度座標，快速透過 SMS、LINE 或通訊軟體發送求救訊息予緊急聯絡人。

---

## 🛠️ 技術架構與選型

```text
taipei-accessible-map/
├── src/
│   ├── app/                 # Next.js 16 App Router (國際化多語系路由 [lng])
│   ├── components/          # UI 元件層
│   │   ├── Navigation/      # 導航 HUD、轉向指標、距離計數器
│   │   ├── BottomSheet/     # 路線搜尋、設施詳情滑動抽屜
│   │   ├── ai/              # AI 助理、思考軌跡與對話面板
│   │   ├── Voice/           # 語音辨識與即時播報元件
│   │   └── ClientMap.tsx    # MapLibre GL 核心地圖與圖層管理
│   ├── lib/                 # 核心領域邏輯與演算法
│   │   ├── navigation/      # 偏航重新規劃、路廊偵測、相機平滑平移
│   │   ├── transit/         # TDX 即時公車、捷運動態與快取
│   │   ├── ai/              # AI 工具呼叫、串流格式化
│   │   └── geo.ts           # 空間運算、距離矩陣與地理幾何演算法
│   ├── stores/              # Zustand 集中式狀態管理
│   └── types/               # 嚴格 TypeScript 型別定義
```

| 領域 | 技術選型 | 說明 |
| :--- | :--- | :--- |
| **前端核心** | **Next.js 16 (Turbopack)** + **React 19** | 最新 App Router 架構，享受 React 19 編譯器效能與極速 Turbopack 開發體驗 |
| **語言與型別** | **TypeScript 5.x** | 全面啟用嚴格型別檢查，確保高可靠度 |
| **地圖渲染** | **MapLibre GL** + **react-map-gl** | 高效能開源向量地圖渲染引擎，擺脫商業圖資授權限制 |
| **圖層聚合** | **Supercluster** + **use-supercluster** | 快速處理數千筆設施圖資的高效空間點位分群演算法 |
| **樣式與動效** | **Tailwind CSS v4** + **Motion** | 極致精簡現代樣式，搭配平滑流暢的手勢與頁面過渡動畫 |
| **UI 元件庫** | **Radix UI Primitives** + **Vaul** | 兼顧完整 WCAG 2.1 AA 無障礙（a11y）語義之組件系統 |
| **狀態管理** | **Zustand** | 輕量且模組化的全域狀態管理（導航、路線、使用者設定） |
| **行動端封裝** | **Capacitor 8 (iOS & Android)** | 將 Web 成果零成本同步至雙平台原生 App |
| **國際化 (i18n)** | **i18next** + **react-i18next** | 完整繁體中文（zh-TW）與英文（en）即時語言切換 |
| **品質與工具** | **Biome** + **Vitest** | 超高速程式碼風格格式化與高達 700+ 個單元/整合測試守護 |

---

## 🚀 快速開始

### 📋 前置需求
- **Node.js**: >= 20.x
- **npm** 或 **pnpm**
- （若要建置行動端）**Android Studio** / **Xcode** 與 CocoaPods

### 1. 複製儲存庫並安裝依賴
```bash
git clone https://github.com/yuzen9622/taipei-accessible-map.git
cd taipei-accessible-map
npm install
```

### 2. 設定環境變數
複製範本檔案並填入相應的金鑰與端點：
```bash
cp .env.example .env.local
```

`.env.local` 內容說明：
```dotenv
# 後端 API 服務端點（例如：串接 TDX 與後端服務之伺服器）
NEXT_PUBLIC_END_POINT=http://localhost:8000

# Google OAuth 用戶端編號（用於使用者登入與障礙回報認證）
NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=your_google_oauth_client_id

# Cloudflare Tunnel Token（用於正式環境安全穿透，本機開發可略過）
TUNNEL_TOKEN=your_cloudflare_tunnel_token_here
```

### 3. 啟動本機開發伺服器
```bash
npm run dev
```
開啟瀏覽器前往 [http://localhost:3000](http://localhost:3000) 即可瀏覽地圖。

---

## 📜 常用開發指令

| 指令 | 說明 |
| :--- | :--- |
| `npm run dev` | 啟動 Turbopack 本機即時熱重載開發伺服器 |
| `npm run build` | 建置 Next.js 正式生產環境版本 |
| `npm run start` | 運行正式建置產物伺服器 |
| `npm run lint` | 使用 Biome 執行靜態程式碼檢查 |
| `npm run format` | 使用 Biome 自動格式化程式碼風格 |
| `npm test` | 執行 Vitest 自動化測試套件（700+ 測試案例） |
| `npm run check:cycles` | 使用 Madge 檢查模組循環依賴狀況 |
| `npm run mobile:sync` | 建置行動端靜態產物並同步至 Capacitor 專案 |
| `npm run android` | 同步行動端資源並以 Android Studio 開啟 |
| `npm run ios` | 同步行動端資源並以 Xcode 開啟 |

---

## 📱 行動端應用開發 (Capacitor)

本系統支援原生打包至 Android 與 iOS：

```bash
# 1. 產生靜態建置輸出並同步至原生專案
npm run mobile:sync

# 2. 開啟 Android 專案進行除錯或打包 APK/AAB
npm run android

# 3. 開啟 iOS 專案進行除錯或發布 TestFlight/App Store (需 macOS + Xcode)
npm run ios
```

---

## 🚢 CI/CD 與部署流程

本專案採用自動化持續整合與容器化部署架構：

1. **自動化檢驗（GitHub Actions CI）**：
   - 每次 Push 或 PR 皆會觸發 `ci.yml`，自動執行 **Biome Lint**、**TypeScript 型別檢查** 與 **Vitest 完整測試**。
2. **安全部署（GHCR + Tailscale + Docker）**：
   - 主分支合併後自動觸發 `deploy.yml`，建置 Docker Image 並推送至 GitHub Container Registry（GHCR）。
   - 透過暫態 Tailscale 節點經由加密虛擬私網 SSH 連線至主機執行 Compose 更新，不對外暴露管理埠口。
   - 搭配 Cloudflare Tunnel 提供高可用 HTTPS 存取。
   - 詳細部署細節與手動回滾步驟請參閱 [docs/deployment.md](./docs/deployment.md)。

---

## ♿ 無障礙設計與無障礙標準

本系統依據 **W3C WCAG 2.1 AA** 等級規範設計：
- **高對比度配色**：支援淺色與深色模式（Dark Mode），文字與背景對比度均達 4.5:1 以上。
- **螢幕報讀器相容**：所有按鈕、圖示均具備合規的 `aria-label` 與無障礙角色宣告，支援 VoiceOver / TalkBack。
- **無障礙操作區**：所有可點擊項目均大於 44x44 pt，兼顧手部精細動作受限者之操作體驗。

---

## 👥 開發團隊與致謝

### 專案指導
- **曾建維 教授**｜指導老師

### 核心開發團隊
- **曹宇鎮** ([@yuzen9622](https://github.com/yuzen9622))｜系統架構、全端開發、演算法與即時資料串接
- **戴子珊** ([@tai33888](https://github.com/tai33888))｜專案統籌與內容策展、使用者體驗規劃與測試
- **李婞娟** ([@Juannnx](https://github.com/Juannnx))｜簡報內容、資訊視覺化與成果包裝
- **游雅喬**｜簡報架構設計、起始動畫與視覺規範

### 資料來源致謝
- [交通部 TDX 運輸資料流通平台](https://tdx.transportdata.ntpc.gov.tw/)
- [臺北市政府資料開放平台](https://data.taipei/)
- [臺北大眾捷運股份有限公司](https://www.metro.taipei/)

---

## 📄 授權條款

本專案採用 [MIT License](./LICENSE.md) 授權開放。

---

## 🌐 English Summary

**Taipei Accessible Navigation System (`taipei-accessible-map`)** is an open-source, intelligent navigation and transit map designed for wheelchair users, elderly people, and individuals with mobility impairments.

### Key Highlights
- **Barrier-Free Routing**: Avoids stairs, overpasses, and pedestrian obstacles; prioritizes elevator and ramp-accessible pathways.
- **Comprehensive Metro Facilities**: Visualizes Taipei Metro accessible elevators, special entrances, wheelchair lifts, and accessible restrooms via Supercluster.
- **Real-Time TDX Transit**: Displays live arrival countdowns for low-floor buses, sub-route details, and scheduled departures.
- **Turn-by-Turn Navigation HUD**: Maneuver guidance, real-time rerouting, distance tickers, and continuous camera follow loop.
- **AI & Voice Guidance**: Natural language assistant with thinking trace displays and voice guidance.
- **Crowdsourced Hazard Reports**: User reports for temporary road hazards and elevator maintenance with photo proof and community voting.
- **Cross-Platform**: Web, PWA, and native Android/iOS mobile apps powered by Capacitor.
- **Tested & Robust**: 700+ automated Vitest tests, 100% strict TypeScript, and WCAG 2.1 AA compliant.

For more information, please check the [Live Demo](https://map.yuzen.dev/) or explore our [Deployment Guide](./docs/deployment.md).
