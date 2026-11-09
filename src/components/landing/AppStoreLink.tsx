import { Download } from "lucide-react";

export default function AppStoreLink() {
  return (
    <a
      className="landing-button button-primary"
      href="https://apps.apple.com/es/app/%E7%84%A1%E9%9A%9C%E7%A4%99%E6%99%BA%E6%85%A7%E5%9C%B0%E5%9C%96/id6820790448"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="前往 App Store 下載無障礙智慧地圖（另開分頁）"
    >
      <Download size={19} aria-hidden="true" />
      App Store 下載
    </a>
  );
}
