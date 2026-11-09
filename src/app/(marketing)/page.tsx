import {
  Accessibility,
  ArrowDown,
  ArrowRight,
  BusFront,
  ChevronDown,
  CircleParking,
  CloudSun,
  Footprints,
  Layers3,
  LifeBuoy,
  MapPin,
  MessageCircle,
  MessageSquareWarning,
  Mountain,
  Route,
  Volume2,
} from "lucide-react";
import AppShowcase from "@/components/landing/AppShowcase";
import AppStoreLink from "@/components/landing/AppStoreLink";
import BusPreview from "@/components/landing/BusPreview";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import HeroPreview from "@/components/landing/HeroPreview";
import Image from "@/components/landing/LandingImage";
import LandingMotion, { HeroAppIcon } from "@/components/landing/LandingMotion";
import LandingNav from "@/components/landing/LandingNav";
import LegacyMapEntry from "@/components/landing/LegacyMapEntry";
import { Iphone } from "@/components/ui/iphone";

const closingRoute =
  "M0 190H240Q280 190 280 150V90Q280 50 320 50H680Q720 50 720 90V150Q720 190 760 190H1000";

const everydayTools = [
  {
    icon: Accessibility,
    title: "附近無障礙設施",
    description: "找電梯、坡道與無障礙廁所，查看位置與設施資訊。",
  },
  {
    icon: CircleParking,
    title: "停車資訊",
    description: "查詢附近停車場與路邊車格，出發前先看停車選擇。",
  },
  {
    icon: CloudSun,
    title: "天氣與空氣品質",
    description: "查看所在地或目的地的環境資訊，把天氣一起考慮進行程。",
  },
  {
    icon: Layers3,
    title: "室內地圖與導航",
    description: "在已提供圖資的場館切換樓層，查看電梯與室內路線。",
  },
  {
    icon: MessageSquareWarning,
    title: "障礙物回報",
    description: "遇到路面障礙或設施問題，標記位置、補上照片與說明。",
  },
  {
    icon: LifeBuoy,
    title: "SOS 緊急求助",
    description: "設定緊急聯絡人，需要協助時從地圖開啟求助流程。",
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

function OpenMap({ secondary = false }: { secondary?: boolean }) {
  return (
    <a
      className={`landing-button ${secondary ? "button-secondary" : "button-primary"}`}
      href="/map/"
    >
      開啟地圖
      <ArrowRight size={19} aria-hidden="true" />
    </a>
  );
}

export default function LandingPage() {
  return (
    <LandingMotion>
      <LegacyMapEntry />
      <a href="#main-content" className="landing-skip">
        跳至主要內容
      </a>
      <header className="landing-header">
        <div className="reading-progress" aria-hidden="true" />
        <div className="landing-container header-inner">
          <a
            href="/"
            className="brand"
            aria-label="無障礙智慧地圖 Accessible Smart Map 首頁"
          >
            <Image src="/logo.webp" width={40} height={40} alt="" />
            <span>
              無障礙智慧地圖<small>Accessible Smart Map</small>
            </span>
          </a>
          <LandingNav />
          <OpenMap />
        </div>
      </header>
      <main id="main-content" className="landing-main">
        <div className="hero-stage">
          <section
            className="hero app-hero landing-container"
            aria-labelledby="hero-title"
          >
            <div className="hero-copy">
              <div className="hero-app-identity">
                <HeroAppIcon />
                <p>無障礙智慧地圖 App</p>
              </div>
              <h1 id="hero-title">
                找一條<span>適合自己的路</span>
              </h1>
              <p className="hero-description">
                從步行、輪椅到搭公車，找到適合自己的路。
                <br />
                語音導航、即時到站與語音助理，陪你走完整趟路。
              </p>
              <div className="hero-actions">
                <AppStoreLink />
                <OpenMap secondary />
              </div>
              <p className="hero-platform-note">
                <a className="text-link" href="#app">
                  探索 App 功能與實際畫面
                  <ArrowDown size={16} aria-hidden="true" />
                </a>
              </p>
            </div>
            <HeroPreview />
          </section>
          <div className="hero-baseline landing-container">
            <a href="#features">
              <ArrowDown size={16} aria-hidden="true" />
              從規劃到抵達，往下看看
            </a>
          </div>
        </div>
        <div className="audience-band">
          <div className="landing-container audience-inner">
            <p>依你的需要，選擇出行方式</p>
            <ul>
              <li>
                <Footprints aria-hidden="true" />
                日常步行
              </li>
              <li>
                <Accessibility aria-hidden="true" />
                輪椅出行
              </li>
              <li>
                <BusFront aria-hidden="true" />
                大眾運輸
              </li>
              <li>
                <MapPin aria-hidden="true" />
                陪伴同行
              </li>
            </ul>
          </div>
        </div>
        <AppShowcase />
        <section
          className="section landing-container"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="section-heading" data-reveal>
            <h2 id="features-title">你的需要，決定怎麼走</h2>
            <p>切換模式，看看同一張地圖能為你多考慮什麼。</p>
          </div>
          <FeatureShowcase />
        </section>
        <section className="terrain-section" aria-labelledby="terrain-title">
          <div className="landing-container terrain-layout">
            <div className="terrain-copy" data-reveal>
              <p className="eyebrow">路線裡的細節</p>
              <h2 id="terrain-title">
                不只多遠，
                <br />
                也看這條路怎麼走
              </h2>
              <p className="terrain-statement">
                <span>哪段有人行道？</span>
                <span>沿途會不會上坡？</span>
                <span>出發前，多了解一點路上的事。</span>
              </p>
              <dl className="terrain-facts">
                <div>
                  <dt>
                    <Route aria-hidden="true" />
                    人行道路段
                  </dt>
                  <dd>以綠色標示已對應的人行道，了解路線的資料覆蓋情況。</dd>
                </div>
                <div>
                  <dt>
                    <Mountain aria-hidden="true" />
                    沿途高程與坡度
                  </dt>
                  <dd>查看路線起伏與爬升變化，衡量自己的體力與通行需要。</dd>
                </div>
              </dl>
              <a className="text-link" href="#faq">
                了解圖資與通行限制
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <figure className="terrain-visual" data-reveal>
              <Image
                width={1440}
                height={1000}
                src="/landing/terrain-desktop.webp"
                alt="劍潭站到圓山大飯店的步行路線與高程圖，可見後段明顯上升"
                sizes="(max-width: 767px) 92vw, 58vw"
              />
            </figure>
          </div>
        </section>
        <section
          className="section landing-container"
          id="journey"
          aria-labelledby="journey-title"
        >
          <div className="section-heading" data-reveal>
            <h2 id="journey-title">聽指引、看公車，路上都有幫手</h2>
            <p>語音導航、即時到站與語音助理，從規劃一路用到抵達。</p>
          </div>
          <div className="journey-grid">
            <article className="journey-feature navigation-feature">
              <div className="journey-text">
                <Volume2 size={28} aria-hidden="true" />
                <h3>語音導航，轉彎用聽的</h3>
                <p>
                  開啟語音播報，聽取轉彎與距離指引。導航隨位置更新，畫面同步顯示下一步與預計抵達時間。
                </p>
                <ul className="journey-points">
                  <li>逐步轉彎與距離播報</li>
                  <li>隨位置更新導航進度</li>
                  <li>剩餘距離與預計抵達時間</li>
                </ul>
              </div>
              <div className="navigation-phone">
                <Iphone
                  src="/landing/navigation-live-native.webp"
                  alt="iPhone 原生 App 正式導航畫面，顯示左轉距離、目前位置及即時語音導航"
                />
              </div>
            </article>
            <article className="journey-feature bus-feature">
              <div className="journey-text">
                <BusFront size={28} aria-hidden="true" />
                <h3>即時公車，知道還要等多久</h3>
                <p>
                  找附近站牌或輸入路線，查看到站倒數與沿途站序。需要搭無障礙公車時，也能切換篩選。
                </p>
                <ul className="journey-points">
                  <li>即時到站時間與進站狀態</li>
                  <li>無障礙公車篩選</li>
                  <li>車快到時提醒、查看沿途站點</li>
                </ul>
              </div>
              <BusPreview />
            </article>
            <article className="journey-feature assistant-feature">
              <div className="journey-text">
                <MessageCircle size={28} aria-hidden="true" />
                <h3>語音助理</h3>
                <p>
                  用文字或語音說出需求，請語音助理找地點、規劃路線，或問清楚哪一站下車、出站後還要走多遠。
                </p>
              </div>
              <figure>
                <Image
                  width={1440}
                  height={1000}
                  src="/landing/assistant-desktop.webp"
                  alt="助理回答台北 101 行程的下車站與出站後步行距離"
                  sizes="(max-width: 767px) 92vw, 56vw"
                />
              </figure>
            </article>
          </div>
        </section>
        <section
          className="everyday-section landing-container"
          id="everyday"
          aria-labelledby="everyday-title"
        >
          <div className="section-heading" data-reveal>
            <h2 id="everyday-title">一張地圖，照顧更多出門的事</h2>
            <p>找設施、看環境、回報問題。需要時，不必換一個工具。</p>
          </div>
          <ul className="everyday-tools">
            {everydayTools.map((tool) => (
              <li key={tool.title} data-reveal>
                <tool.icon size={24} aria-hidden="true" />
                <div>
                  <h3>{tool.title}</h3>
                  <p>{tool.description}</p>
                </div>
              </li>
            ))}
          </ul>
          <a className="text-link everyday-link" href="/map/">
            到地圖探索所有功能 <ArrowRight size={18} aria-hidden="true" />
          </a>
        </section>
        <section
          className="faq-section landing-container"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading" data-reveal>
            <h2 id="faq-title">
              出發前，
              <br />
              你可能想知道
            </h2>
            <p>
              關於使用方式、路線模式，
              <br />
              以及地圖能告訴你的事。
            </p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={20} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing-section landing-container" data-reveal>
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
          <div className="closing-mark">
            <Image src="/logo.webp" width={72} height={72} alt="" />
          </div>
          <h2>下一站，想去哪裡？</h2>
          <p>從你的需要開始，規劃今天的路線</p>
          <OpenMap />
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container footer-inner">
          <a href="/" className="brand">
            <Image src="/logo.webp" width={32} height={32} alt="" />
            <span>無障礙智慧地圖</span>
          </a>
          <p>Accessible Smart Map</p>
          <nav aria-label="法律文件">
            <a href="/zh-TW/policies/privacy-policy/">隱私權政策</a>
            <a href="/zh-TW/policies/terms-of-use/">使用條款</a>
          </nav>
        </div>
        <p className="landing-container footer-map-credit">
          <a href="https://openfreemap.org/">OpenFreeMap</a>
          {" · "}
          <a href="https://openmaptiles.org/">© OpenMapTiles</a>
          {" · "}
          <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
        </p>
      </footer>
    </LandingMotion>
  );
}
