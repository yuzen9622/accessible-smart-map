import { Iphone } from "@/components/ui/iphone";

const previews = [
  {
    image: "explore-native",
    label: "找到沿途設施",
    alt: "App 地圖顯示臺北車站周邊電梯，以及坡道、廁所與停車篩選入口",
  },
  {
    image: "navigation-live-native",
    label: "跟著語音出發",
    alt: "App 導航畫面顯示下一個左轉、剩餘距離與即時語音播報",
  },
  {
    image: "bus-arrivals-native",
    label: "掌握公車到站",
    alt: "App 站牌畫面顯示臺北車站忠孝站的公車到站倒數",
  },
];

export default function HeroPreview() {
  return (
    <div className="hero-preview app-preview">
      {previews.map((preview) => (
        <figure className="app-preview-item" key={preview.image}>
          <div className="app-phone-wrapper">
            <Iphone
              src={`/landing/${preview.image}.webp`}
              alt={preview.alt}
              className="hero-iphone"
            />
          </div>
          <figcaption>{preview.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
