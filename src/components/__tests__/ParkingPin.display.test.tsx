import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParkingNearbyItem } from "@/types/route";

const h = vi.hoisted(() => ({
  selected: vi.fn(),
  info: vi.fn(),
  search: vi.fn(),
  sheet: vi.fn(),
  fly: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [false, vi.fn()],
}));
vi.mock("zustand/react/shallow", () => ({ useShallow: (s: unknown) => s }));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hook/usePin", () => ({
  default: () => ({ handlePinClick: h.fly }),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (s: (state: unknown) => unknown) =>
    s({
      selectedParking: null,
      setSelectedParking: h.selected,
      setInfoShow: h.info,
      setSearchPlace: h.search,
      setSheetMode: h.sheet,
    }),
}));
vi.mock("react-map-gl/maplibre", () => ({
  Marker: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => children,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => children,
  HoverCardContent: ({ children }: { children: ReactNode }) => children,
}));

import ParkingPin from "../ParkingPin";

const lot: ParkingNearbyItem = {
  type: "lot",
  _id: "stable",
  carParkId: "CP1",
  name: "中文停車場",
  address: "中文地址",
  displayName: "English parking",
  displayAddress: "English address",
  city: "Taipei",
  importedAt: "",
  location: { type: "Point", coordinates: [121, 25] },
};
beforeEach(() => vi.clearAllMocks());
function findButton(
  node: ReactNode,
): { onClick: (event: { stopPropagation: () => void }) => void } | undefined {
  if (Array.isArray(node)) return node.map(findButton).find(Boolean);
  if (
    !isValidElement<{
      children?: ReactNode;
      onClick: (event: { stopPropagation: () => void }) => void;
    }>(node)
  )
    return undefined;
  if (node.type === "button") return node.props;
  return findButton(node.props.children);
}
describe("ParkingPin display and canonical action", () => {
  it("shows display names and addresses, but preserves canonical address and item ID on click", () => {
    const html = renderToStaticMarkup(<ParkingPin item={lot} />);
    expect(html).toContain("English parking");
    expect(html).toContain("English address");
    expect(html).not.toContain("中文停車場");
    const button = findButton(ParkingPin({ item: lot }));
    expect(button).toBeDefined();
    button?.onClick({ stopPropagation: vi.fn() });
    expect(h.selected).toHaveBeenCalledWith(lot);
    expect(h.info).toHaveBeenCalledWith({
      isOpen: true,
      kind: "coordinate",
      address: "中文停車場, 中文地址",
      position: { lng: 121, lat: 25 },
    });
    expect(h.fly).toHaveBeenCalledWith({ lng: 121, lat: 25 });
  });
  it("falls back from whitespace display to canonical", () => {
    const html = renderToStaticMarkup(
      <ParkingPin item={{ ...lot, displayName: " ", displayAddress: " " }} />,
    );
    expect(html).toContain("中文停車場");
    expect(html).toContain("中文地址");
  });
});
