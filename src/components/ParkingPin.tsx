import { CircleParking } from "lucide-react";
import { useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useShallow } from "zustand/react/shallow";
import { parkingItemLngLat } from "@/components/BottomSheet/ParkingPanel";
import usePin from "@/hook/usePin";
import { useAppTranslation } from "@/i18n/client";
import { nonemptyName } from "@/lib/route/sourceNames";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import type { ParkingNearbyItem } from "@/types/route";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

export default function ParkingPin({ item }: { item: ParkingNearbyItem }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const {
    selectedParking,
    setSelectedParking,
    setSheetMode,
    setInfoShow,
    setSearchPlace,
  } = useMapStore(
    useShallow((s) => ({
      selectedParking: s.selectedParking,
      setSelectedParking: s.setSelectedParking,
      setSheetMode: s.setSheetMode,
      setInfoShow: s.setInfoShow,
      setSearchPlace: s.setSearchPlace,
    })),
  );
  const { handlePinClick } = usePin();

  const pos = parkingItemLngLat(item);
  if (!pos) return null;

  const isSelected = selectedParking?._id === item._id;
  const canonicalTitle = item.type === "lot" ? item.name : item.placeName;
  const title =
    nonemptyName(item.displayName) ||
    nonemptyName(canonicalTitle) ||
    t("parking");
  const subtitle =
    item.type === "lot"
      ? nonemptyName(item.displayAddress) || item.address || undefined
      : item.district || undefined;

  const handleClick = () => {
    handlePinClick(pos);
    setSelectedParking(item);
    const canonicalSubtitle =
      item.type === "lot" ? item.address : item.district;
    const fullAddress = canonicalSubtitle
      ? `${canonicalTitle}, ${canonicalSubtitle}`
      : canonicalTitle;
    setInfoShow({
      isOpen: true,
      kind: "coordinate",
      address: fullAddress,
      position: { lat: pos.lat, lng: pos.lng },
    });
    setSearchPlace({
      kind: "coordinate",
      address: fullAddress,
      position: { lat: pos.lat, lng: pos.lng },
    });
    setSheetMode("place");
    setOpen(true);
  };

  return (
    <HoverCard open={open} onOpenChange={setOpen} key={item._id}>
      <HoverCardTrigger asChild>
        <div>
          <Marker
            longitude={pos.lng}
            latitude={pos.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              handleClick();
            }}
          >
            <button
              type="button"
              aria-label={title}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className={cn(
                "bg-background p-1 text-muted-foreground ring-2 ring-ring rounded-full cursor-pointer",
                isSelected && "ring-accent-foreground text-accent-foreground",
              )}
            >
              <CircleParking size={18} />
            </button>
          </Marker>
        </div>
      </HoverCardTrigger>
      <HoverCardContent>
        <h1>{title}</h1>
        {subtitle && <p className="text-sm">{subtitle}</p>}
        <p>
          {pos.lat}, {pos.lng}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
