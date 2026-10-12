import { arrowsUpDownSquare } from "@lucide/lab";
import { AccessibilityIcon, Icon, ToiletIcon } from "lucide-react";
import { useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useShallow } from "zustand/react/shallow";
import usePin from "@/hook/usePin";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import type { Marker as MarkerType } from "@/types";
import { A11yEnum } from "@/types/index";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

export default function A11yFacilityPin({ place }: { place: MarkerType }) {
  const [open, setOpen] = useState(false);
  const {
    selectA11yPlace,
    setSelectA11yPlace,
    setSheetMode,
    setInfoShow,
    setSearchPlace,
  } = useMapStore(
    useShallow((s) => ({
      selectA11yPlace: s.selectA11yPlace,
      setSelectA11yPlace: s.setSelectA11yPlace,
      setSheetMode: s.setSheetMode,
      setInfoShow: s.setInfoShow,
      setSearchPlace: s.setSearchPlace,
    })),
  );
  const { handlePinClick } = usePin();

  const A11yIcon = () => {
    if (place.a11yType === A11yEnum.ELEVATOR) {
      return <Icon iconNode={arrowsUpDownSquare} size={18} />;
    } else if (place.a11yType === A11yEnum.RAMP) {
      return <AccessibilityIcon size={18} />;
    } else {
      return <ToiletIcon size={18} />;
    }
  };

  const handleClick = () => {
    handlePinClick(place.position);
    setSelectA11yPlace(place);
    const title = place.content?.title || "無障礙設施";
    const desc = place.content?.desc;
    const fullAddress = desc ? `${title} (${desc})` : title;
    const canonicalTitle = place.canonicalTitle ?? title;
    const canonicalAddress = desc
      ? `${canonicalTitle} (${desc})`
      : canonicalTitle;
    const facilityIdentity = { facilityId: place.id, canonicalAddress };
    setInfoShow({
      ...facilityIdentity,
      isOpen: true,
      kind: "coordinate",
      address: fullAddress,
      position: place.position,
    });
    setSearchPlace({
      ...facilityIdentity,
      kind: "coordinate",
      address: fullAddress,
      position: place.position,
    });
    setSheetMode("place");
    setOpen(true);
  };

  return (
    <HoverCard open={open} onOpenChange={setOpen} key={place.id}>
      <HoverCardTrigger asChild>
        <div>
          <Marker
            longitude={place.position.lng}
            latitude={place.position.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              handleClick();
            }}
          >
            <button
              type="button"
              aria-label={place.content?.title || "設施"}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className={cn(
                "bg-background p-1 text-muted-foreground ring-2 ring-ring rounded-full cursor-pointer",
                selectA11yPlace?.id === place.id &&
                  "ring-accent-foreground text-accent-foreground",
              )}
            >
              {A11yIcon()}
            </button>
          </Marker>
        </div>
      </HoverCardTrigger>
      <HoverCardContent>
        <h1>{place.content?.title}</h1>
        <p className="text-sm">{place.content?.desc}</p>
        <p>
          {place.position.lat}, {place.position.lng}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
