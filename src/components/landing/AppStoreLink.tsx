import { ArrowDownToLine } from "lucide-react";
import { PillLink } from "./LandingUI";

export default function AppStoreLink({
  variant = "primary",
}: {
  variant?: "primary" | "ghost";
}) {
  return (
    <PillLink
      href="https://apps.apple.com/es/app/%E7%84%A1%E9%9A%9C%E7%A4%99%E6%99%BA%E6%85%A7%E5%9C%B0%E5%9C%96/id6820790448"
      external
      variant={variant}
      label="前往 App Store 下載無障礙智慧地圖（另開分頁）"
      icon={<ArrowDownToLine size={16} strokeWidth={1.5} />}
    >
      App Store 下載
    </PillLink>
  );
}
