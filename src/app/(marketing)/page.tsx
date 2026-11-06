import {
  Accessibility,
  ArrowDown,
  ArrowRight,
  BusFront,
  ChevronDown,
  Footprints,
  MapPin,
  MessageCircle,
  Mountain,
  Navigation,
  Route,
} from "lucide-react";
import AsciiBrand from "@/components/landing/AsciiBrand";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import Image from "@/components/landing/LandingImage";
import LandingMotion from "@/components/landing/LandingMotion";
import LegacyMapEntry from "@/components/landing/LegacyMapEntry";
import { Iphone } from "@/components/landing/magicui/iphone";
import { Safari } from "@/components/landing/magicui/safari";

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
    "AI 助理能幫忙做什麼？",
    "你可以用自然語言描述要找的地點或出行需求，讓 AI 助理協助查詢與規劃。規劃結果仍須確認路線、設施資訊與現場狀況，AI 回覆不是通行保證。",
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
          <nav aria-label="主要導覽">
            <a href="#features">特色功能</a>
            <a href="#journey">出行幫手</a>
            <a href="#faq">常見問題</a>
          </nav>
          <OpenMap />
        </div>
      </header>
      <main id="main-content">
        <div className="hero-stage">
          <AsciiBrand />
          <section
            className="hero landing-container"
            aria-labelledby="hero-title"
          >
            <div className="hero-copy">
              <p className="eyebrow">依你的需要，規劃每一程</p>
              <h1 id="hero-title">
                每一段路，<span>都有你的走法。</span>
              </h1>
              <p className="hero-description">
                把人行道、坡度與沿途設施一起考慮。
                <br />
                從日常步行到輪椅出行，找到適合的路。
              </p>
              <div className="hero-actions">
                <OpenMap />
                <a className="landing-button button-secondary" href="#features">
                  看看怎麼走
                  <ArrowDown size={18} aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-visual-label">
                <span className="live-dot" />
                從地圖，看見更多可能
              </div>
              <div className="hero-desktop">
                <Safari
                  url="map.yuzen.dev/map"
                  imageSrc="/landing/route-desktop.webp"
                  alt="無障礙智慧地圖桌機版，顯示實際路線規劃與地圖"
                  priority
                  sizes="(max-width: 767px) 85vw, 50vw"
                />
              </div>
              <div className="hero-phone">
                <Iphone
                  src="/landing/route-native.webp"
                  priority
                  sizes="(max-width: 767px) 32vw, 210px"
                  alt="iPhone 原生 App 的實際路線規劃畫面"
                />
              </div>
            </div>
          </section>
          <div className="hero-baseline landing-container">
            <a href="#features">
              <ArrowDown size={16} aria-hidden="true" />
              往下探索，你的走法
            </a>
          </div>
        </div>
        <div className="audience-band">
          <div className="landing-container audience-inner">
            <p>每一種出行，都值得被考慮。</p>
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
        <section
          className="section landing-container"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="section-heading" data-reveal>
            <p className="section-index">
              <span>01</span> YOUR WAY
            </p>
            <h2 id="features-title">
              同一個目的地，
              <br className="mobile-break" />
              不只一種抵達方式。
            </h2>
            <p>選擇你的出行模式，看看路線如何回應你的需要。</p>
          </div>
          <FeatureShowcase />
        </section>
        <section className="terrain-section" aria-labelledby="terrain-title">
          <div className="landing-container terrain-layout">
            <div className="terrain-copy" data-reveal>
              <p className="section-index">
                <span>02</span> EVERY DETAIL
              </p>
              <p className="eyebrow">距離之外，也看見路的細節</p>
              <h2 id="terrain-title">
                這條路怎麼走，
                <br />
                出發前先知道。
              </h2>
              <p>
                哪段有人行道？沿途會不會上坡？把原本藏在地圖裡的資訊，變成出發前可以參考的線索。
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
              <Safari
                url="map.yuzen.dev/map"
                imageSrc="/landing/terrain-desktop.webp"
                alt="路線規劃的真實地圖與路線高程資訊"
                sizes="(max-width: 767px) 92vw, 58vw"
              />
              <figcaption>
                綠色表示圖資對應；高程依圖資估算，均非現場通行認證。
              </figcaption>
            </figure>
          </div>
        </section>
        <section
          className="section landing-container"
          id="journey"
          aria-labelledby="journey-title"
        >
          <div className="section-heading" data-reveal>
            <p className="section-index">
              <span>03</span> ALONG THE WAY
            </p>
            <h2 id="journey-title">
              從想到出發，
              <br />
              到每一個轉彎。
            </h2>
            <p>找地點、看轉乘、跟著導航。需要的幫手，都在同一張地圖。</p>
          </div>
          <div className="journey-grid">
            <article data-reveal className="journey-feature assistant-feature">
              <div className="journey-text">
                <MessageCircle size={28} aria-hidden="true" />
                <h3>想去哪裡，直接說。</h3>
                <p>
                  用日常的語言告訴 AI
                  助理你的需求，從找地點開始，一起整理出行選擇。
                </p>
              </div>
              <figure>
                <Safari
                  url="map.yuzen.dev/map"
                  imageSrc="/landing/assistant-desktop.webp"
                  alt="AI 助理的實際對話介面"
                  sizes="(max-width: 767px) 92vw, 56vw"
                />
              </figure>
            </article>
            <article data-reveal className="journey-feature navigation-feature">
              <div className="journey-text">
                <Navigation size={28} aria-hidden="true" />
                <h3>下一個轉彎，清楚一點。</h3>
                <p>逐步路線指引與導航提示，讓注意力回到眼前的路。</p>
              </div>
              <div className="navigation-phone">
                <Iphone
                  src="/landing/navigation-native.webp"
                  alt="iPhone 原生 App 的實際導航畫面"
                  sizes="(max-width: 767px) 65vw, 260px"
                />
              </div>
            </article>
            <article data-reveal className="journey-feature transit-feature">
              <div className="journey-text">
                <BusFront size={28} aria-hidden="true" />
                <h3>把下一站，也一起想好。</h3>
                <p>查看公車、捷運與步行接駁資訊，規劃完整的一趟出行。</p>
              </div>
              <figure>
                <Safari
                  url="map.yuzen.dev/map"
                  imageSrc="/landing/transit-desktop.webp"
                  alt="大眾運輸路線與轉乘資訊的實際畫面"
                  sizes="(max-width: 767px) 92vw, 56vw"
                />
              </figure>
            </article>
          </div>
          <p className="capture-note">
            2026/11/05
            實際操作截圖。路線、班次與設施狀態，以使用當下的查詢結果為準。
          </p>
        </section>
        <section
          className="faq-section landing-container"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading" data-reveal>
            <p className="section-index">
              <span>04</span> BEFORE YOU GO
            </p>
            <h2 id="faq-title">
              出發之前，
              <br />
              你可能想知道。
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
          <div className="closing-pattern" aria-hidden="true" />
          <div className="closing-mark">
            <Image src="/logo.webp" width={72} height={72} alt="" />
          </div>
          <h2>
            下一段路，
            <br />
            從你的需要開始。
          </h2>
          <p>打開地圖，看看今天想去的地方。</p>
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
      </footer>
    </LandingMotion>
  );
}
