import { Iphone } from "@/components/ui/iphone";

const previews = [
  {
    image: "explore-native",
    label: "找到沿途設施",
    position: "left",
    alt: "App 地圖顯示臺北車站周邊電梯，以及坡道、廁所與停車篩選入口",
  },
  {
    image: "navigation-live-native",
    label: "跟著語音出發",
    position: "center",
    alt: "App 導航畫面顯示下一個左轉、剩餘距離與即時語音播報",
  },
  {
    image: "bus-arrivals-native",
    label: "掌握公車到站",
    position: "right",
    alt: "App 站牌畫面顯示臺北車站忠孝站的公車到站倒數",
  },
];

/** Three real native captures stacked on the z-axis; motion fans them out on scroll. */
export default function HeroPreview() {
  return (
    <div className="hero-preview">
      <div className="hero-halo" aria-hidden="true" />
      {previews.map((preview) => (
        <figure
          className={`hero-phone hero-phone-${preview.position}`}
          key={preview.image}
          data-hero-phone={preview.position}
        >
          <div className="hero-phone-tilt">
            <Iphone src={`/landing/${preview.image}.webp`} alt={preview.alt} />
          </div>
          <figcaption className="hero-chip">
            <span aria-hidden="true" />
            {preview.label}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
