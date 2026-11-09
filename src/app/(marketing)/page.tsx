import {
  Accessibility,
  ArrowDown,
  ArrowUpRight,
  BusFront,
  CircleParking,
  CloudSun,
  Footprints,
  Layers3,
  LifeBuoy,
  MapPin,
  MessageSquareWarning,
  Mountain,
  Route,
} from "lucide-react";
import AppShowcase from "@/components/landing/AppShowcase";
import AppStoreLink from "@/components/landing/AppStoreLink";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import HeroPreview from "@/components/landing/HeroPreview";
import JourneyDeck from "@/components/landing/JourneyDeck";
import Image from "@/components/landing/LandingImage";
import LandingMotion, { HeroAppIcon } from "@/components/landing/LandingMotion";
import LandingNav from "@/components/landing/LandingNav";
import {
  Bezel,
  PillLink,
  ScrubText,
  SplitLine,
} from "@/components/landing/LandingUI";
import LegacyMapEntry from "@/components/landing/LegacyMapEntry";

const thin = { strokeWidth: 1.4, "aria-hidden": true } as const;

const heroRoute =
  "M-40 610 C 120 600 180 520 300 512 S 470 560 560 470 S 690 300 820 300 S 1010 220 1120 140 S 1300 90 1500 60";

const closingRoute =
  "M0 190H240Q280 190 280 150V90Q280 50 320 50H680Q720 50 720 90V150Q720 190 760 190H1000";

const modes = [
  { icon: Footprints, label: "日常步行" },
  { icon: Accessibility, label: "輪椅出行" },
  { icon: BusFront, label: "大眾運輸" },
  { icon: MapPin, label: "陪伴同行" },
];

const ticker = [
  "日常步行",
  "輪椅出行",
  "語音導航",
  "即時公車",
  "無障礙設施",
  "人行道與坡度",
  "語音助理",
  "室內地圖",
  "障礙物回報",
  "SOS 緊急求助",
];

const manifestoQuestions = [
  "哪裡有階梯",
  "哪段要上坡",
  "電梯在哪個出口",
  "公車還要等多久",
];

const everydayTools = [
  {
    icon: Accessibility,
    title: "附近無障礙設施",
    description: "找電梯、坡道與無障礙廁所，查看位置與設施資訊。",
    span: "tool-wide",
  },
  {
    icon: Layers3,
    title: "室內地圖與導航",
    description: "在已提供圖資的場館切換樓層，查看電梯與室內路線。",
    span: "tool-tall",
  },
  {
    icon: CircleParking,
    title: "停車資訊",
    description: "查詢附近停車場與路邊車格，出發前先看停車選擇。",
    span: "",
  },
  {
    icon: CloudSun,
    title: "天氣與空氣品質",
    description: "查看所在地或目的地的環境資訊，把天氣一起考慮進行程。",
    span: "",
  },
  {
    icon: MessageSquareWarning,
    title: "障礙物回報",
    description: "遇到路面障礙或設施問題，標記位置、補上照片與說明。",
    span: "",
  },
  {
    icon: LifeBuoy,
    title: "SOS 緊急求助",
    description: "設定緊急聯絡人，需要協助時從地圖開啟求助流程。",
    span: "tool-wide tool-alert",
  },
];

const faqs = [
  [
    "一般模式與輪椅模式有什麼不同？",
    "一般模式提供日常出行的路線選擇；輪椅模式會依輪椅通行需求考慮階梯、坡度與相關設施。請一併查看每條路線的提醒與資料完整度，選擇符合自身情況的路線。",
  ],
  [
    "地圖上的綠色路段代表什麼？",
    "綠色表示這段路線已對應到人行道圖資，不代表每一段都經現場查核，也不是輪椅可通行或安全認證。坡道、路面狀況與臨時障礙，仍須搭配現場情況判斷。",
  ],
  [
    "人行道覆蓋率與坡度資訊怎麼看？",
    "人行道覆蓋率反映路線中已對應人行道資料的比例，並非整座城市的建置率。高程與坡度依圖資估算，協助了解路線起伏；資料缺漏不等於沒有坡度，也不能取代現場測量。",
  ],
  [
    "找不到輪椅路線，就代表無路可走嗎？",
    "不一定。這表示目前的規劃器與資料沒有找到符合條件的候選路線，可能受到圖資涵蓋、路網連接或設施資料影響。可調整起終點並確認現場資訊，不建議為了取得結果而放寬必要的通行條件。",
  ],
  [
    "需要下載 App 或登入才能使用嗎？",
    "可以直接開啟網頁版開始探索地圖與規劃路線。部分個人化與帳號功能需要登入；實際可用功能以介面提示為準。",
  ],
  [
    "語音助理能幫忙做什麼？",
    "你可以用文字或語音描述要找的地點與出行需求，讓語音助理協助查詢與規劃。規劃結果仍須確認路線、設施資訊與現場狀況，助理回覆不是通行保證。",
  ],
];

function MapTexture() {
  return (
    <svg
      className="hero-map"
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      <g className="hero-map-streets">
        <path d="M0 120H1440M0 260H1440M0 430H1440M0 590H1440" />
        <path d="M140 0V720M380 0V720M610 0V720M880 0V720M1120 0V720M1330 0V720" />
        <path d="M0 700L700 0M420 720L1140 0M900 720L1440 180" />
      </g>
      <path className="hero-map-route-glow" d={heroRoute} />
      <path
        className="hero-map-route"
        d={heroRoute}
        pathLength="1"
        data-route-line
      />
      <circle className="hero-map-stop" cx="300" cy="512" r="7" />
      <circle className="hero-map-stop" cx="820" cy="300" r="7" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <LandingMotion>
      <LegacyMapEntry />
      <a href="#main-content" className="landing-skip">
        跳至主要內容
      </a>
      <div className="landing-grain" aria-hidden="true" />
      <LandingNav />
      <main id="main-content" className="landing-main">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-backdrop" aria-hidden="true">
            <div className="hero-orb hero-orb-a" />
            <div className="hero-orb hero-orb-b" />
            <MapTexture />
          </div>
          <div className="hero-inner landing-container">
            <div className="hero-copy">
              <div className="hero-app-identity">
                <HeroAppIcon />
                <p className="hero-label">無障礙智慧地圖</p>
              </div>
              <h1 id="hero-title" data-split="hero">
                <SplitLine text="找一條" />
                <SplitLine
                  text="適合自己的路"
                  className="display-accent hero-accent"
                />
              </h1>
              <p className="hero-description">
                從步行、輪椅到搭公車，依你的需要規劃路線。語音導航、即時到站與語音助理，陪你走完整趟路。
              </p>
              <div className="hero-actions">
                <AppStoreLink />
                <PillLink href="/map/" variant="ghost">
                  開啟網頁版地圖
                </PillLink>
              </div>
              <ul className="hero-modes" aria-label="支援的出行方式">
                {modes.map((mode) => (
                  <li key={mode.label}>
                    <mode.icon size={16} {...thin} />
                    {mode.label}
                  </li>
                ))}
              </ul>
            </div>
            <HeroPreview />
          </div>
          <a className="hero-scroll-cue" href="#manifesto">
            <span className="hero-scroll-line" aria-hidden="true" />
            往下捲動，從規劃一路看到抵達
          </a>
        </section>

        {/* ── Ticker ───────────────────────────────────────── */}
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[0, 1].map((copy) => (
              <ul key={copy}>
                {ticker.map((item) => (
                  <li key={item}>
                    {item}
                    <span className="ticker-star">✦</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ── Manifesto ────────────────────────────────────── */}
        <section
          className="manifesto landing-container"
          id="manifesto"
          aria-label="我們在意的事"
        >
          <p className="manifesto-lead" data-scrub-text>
            <span>
              <ScrubText text="距離" />
            </span>
            <span className="manifesto-lead-rest">
              <ScrubText text="只是路線的一部分" />
            </span>
          </p>
          <ol className="manifesto-questions">
            {manifestoQuestions.map((question) => (
              <li key={question} data-scrub-text>
                <span className="manifesto-stop" aria-hidden="true" />
                <span className="manifesto-question">
                  <ScrubText text={question} />
                </span>
              </li>
            ))}
          </ol>
          <p className="manifesto-close" data-scrub-text>
            <span className="manifesto-close-line" aria-hidden="true" />
            <span>
              <ScrubText text="這些" />
              <br />
              <ScrubText text="才決定你能不能好好出門" />
            </span>
          </p>
        </section>

        <AppShowcase />

        {/* ── Route modes ──────────────────────────────────── */}
        <section
          className="section landing-container"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="section-heading">
            <h2 id="features-title" data-split>
              <SplitLine text="你的需要" />
              <SplitLine text="決定怎麼走" className="display-accent" />
            </h2>
            <p data-reveal>切換模式，看看同一張地圖能為你多考慮什麼。</p>
          </div>
          <FeatureShowcase />
        </section>

        {/* ── Terrain bento ────────────────────────────────── */}
        <section
          className="section landing-container"
          id="terrain"
          aria-labelledby="terrain-title"
        >
          <div className="section-heading section-heading-split">
            <div>
              <h2 id="terrain-title" data-split>
                <SplitLine text="不只多遠" />
                <SplitLine text="也看這條路怎麼走" className="display-accent" />
              </h2>
            </div>
            <p data-reveal>
              哪段有人行道？沿途會不會上坡？出發前，多了解一點路上的事。
            </p>
          </div>
          <div className="terrain-bento">
            <Bezel className="bento-hero" coreClassName="bento-shot">
              <figure data-parallax-media>
                <Image
                  width={1440}
                  height={1000}
                  src="/landing/terrain-desktop.webp"
                  alt="劍潭站到圓山大飯店的步行路線與高程圖，可見後段明顯上升"
                  sizes="(max-width: 767px) 92vw, 62vw"
                />
              </figure>
              <p className="bento-tag">捷運劍潭站一號出口 → 圓山大飯店</p>
            </Bezel>
            <Bezel className="bento-stat" coreClassName="bento-card">
              <Mountain size={22} {...thin} />
              <div className="stat-pair">
                <p>
                  <span className="stat-number" data-count="30">
                    30
                  </span>
                  <small>m</small>
                </p>
                <p className="stat-label">累計上升</p>
              </div>
              <div className="stat-pair">
                <p>
                  <span className="stat-number" data-count="4">
                    4
                  </span>
                  <small>m</small>
                </p>
                <p className="stat-label">累計下降</p>
              </div>
              <p className="bento-note">
                此範例路線的高程估算，查看起伏與爬升變化，衡量自己的體力與通行需要。
              </p>
            </Bezel>
            <Bezel className="bento-route" coreClassName="bento-card">
              <Route size={22} {...thin} />
              <svg
                className="bento-route-line"
                viewBox="0 0 320 80"
                fill="none"
                aria-hidden="true"
              >
                <path
                  className="route-muted"
                  d="M8 60 C 60 60 70 20 120 20 S 190 64 240 50 S 300 20 312 20"
                />
                <path
                  className="route-green"
                  d="M8 60 C 60 60 70 20 120 20 S 190 64 240 50 S 300 20 312 20"
                  pathLength="1"
                  data-route-line
                />
              </svg>
              <h3>人行道路段</h3>
              <p>以綠色標示已對應的人行道，了解路線的資料覆蓋情況。</p>
              <a className="text-link" href="#faq">
                綠色不等於通行認證
                <ArrowUpRight size={15} strokeWidth={1.5} aria-hidden="true" />
              </a>
            </Bezel>
          </div>
        </section>

        <JourneyDeck />

        {/* ── Everyday bento ───────────────────────────────── */}
        <section
          className="section landing-container"
          id="everyday"
          aria-labelledby="everyday-title"
        >
          <div className="section-heading section-heading-split">
            <div>
              <h2 id="everyday-title" data-split>
                <SplitLine text="一張地圖" />
                <SplitLine text="照顧更多出門的事" className="display-accent" />
              </h2>
            </div>
            <p data-reveal>
              找設施、看環境、回報問題。需要時，不必換一個工具。
            </p>
          </div>
          <ul className="tools-bento">
            {everydayTools.map((tool) => (
              <li
                key={tool.title}
                className={`bezel tool ${tool.span}`}
                data-reveal
                data-spotlight
              >
                <div className="bezel-core tool-core">
                  <span className="tool-icon">
                    <tool.icon size={22} {...thin} />
                  </span>
                  <div>
                    <h3>{tool.title}</h3>
                    <p>{tool.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="tools-footer" data-reveal>
            <PillLink href="/map/" variant="ghost">
              到地圖探索所有功能
            </PillLink>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section
          className="faq-section landing-container"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading">
            <h2 id="faq-title" data-split>
              <SplitLine text="出發前" />
              <SplitLine text="你可能想知道" className="display-accent" />
            </h2>
            <p data-reveal>
              關於使用方式、路線模式，以及地圖能告訴你的事，也包括它不能保證的事。
            </p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question} data-reveal>
                <summary>
                  <span className="faq-question">{question}</span>
                  <span className="faq-toggle" aria-hidden="true" />
                </summary>
                <div className="faq-answer">
                  <p>{answer}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ── Closing ──────────────────────────────────────── */}
        <section className="closing" aria-labelledby="closing-title">
          <div className="closing-inner landing-container">
            <svg
              className="closing-route"
              viewBox="0 0 1000 240"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={closingRoute}
                className="closing-route-track"
                pathLength="1"
                data-route-line
              />
              <path
                d={closingRoute}
                pathLength="1"
                className="closing-route-flow closing-route-trail"
              />
              <path
                d={closingRoute}
                pathLength="1"
                className="closing-route-flow closing-route-head"
              />
            </svg>
            <div className="closing-mark" data-reveal>
              <Image src="/logo.webp" width={72} height={72} alt="" />
            </div>
            <h2 id="closing-title" data-split>
              <SplitLine text="下一站" />
              <SplitLine text="想去哪裡？" className="display-accent" />
            </h2>
            <p data-reveal>從你的需要開始，規劃今天的路線。</p>
            <div className="closing-actions" data-reveal>
              <PillLink href="/map/">開啟地圖</PillLink>
              <AppStoreLink variant="ghost" />
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <p className="footer-wordmark" aria-hidden="true">
          Accessible Smart Map
        </p>
        <div className="landing-container footer-inner">
          <div className="footer-top">
            <a href="/" className="brand">
              <Image src="/logo.webp" width={32} height={32} alt="" />
              <span>無障礙智慧地圖</span>
            </a>
            <nav aria-label="頁尾導覽">
              <a href="#app">App 介紹</a>
              <a href="#features">路線規劃</a>
              <a href="#journey">出行幫手</a>
              <a href="#faq">常見問題</a>
            </nav>
            <nav aria-label="法律文件">
              <a href="/zh-TW/policies/privacy-policy/">隱私權政策</a>
              <a href="/zh-TW/policies/terms-of-use/">使用條款</a>
            </nav>
            <a className="footer-top-link" href="#main-content">
              回到頂端
              <ArrowDown
                size={14}
                strokeWidth={1.5}
                aria-hidden="true"
                className="flip"
              />
            </a>
          </div>
          <p className="footer-map-credit">
            地圖資料：
            <a href="https://openfreemap.org/">OpenFreeMap</a>
            {" · "}
            <a href="https://openmaptiles.org/">© OpenMapTiles</a>
            {" · "}
            <a href="https://www.openstreetmap.org/copyright">
              © OpenStreetMap
            </a>
          </p>
        </div>
      </footer>
    </LandingMotion>
  );
}
