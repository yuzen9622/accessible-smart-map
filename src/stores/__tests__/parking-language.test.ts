import { beforeEach, describe, expect, it } from "vitest";
import type { ParkingNearbyItem } from "@/types/route";
import useMapStore from "../useMapStore";

const canonical: ParkingNearbyItem = {
  type: "lot",
  _id: "id",
  name: "中文",
  carParkId: "CP1",
  city: "Taipei",
  importedAt: "",
  location: { type: "Point", coordinates: [121, 25] },
};
beforeEach(() =>
  useMapStore.setState({
    nearbyParking: [],
    nearbyParkingLanguage: undefined,
    selectedParking: null,
  }),
);
describe("parking response language provenance", () => {
  it("refreshes selected payload by stable ID on locale update", () => {
    const zh = { ...canonical, displayName: "中文顯示" };
    useMapStore.getState().setNearbyParking([zh], "zh-TW");
    useMapStore.getState().setSelectedParking(zh);
    const en = {
      ...canonical,
      displayName: "English",
      displayAddress: "English address",
    };
    useMapStore.getState().setNearbyParking([en], "en");
    expect(useMapStore.getState().nearbyParkingLanguage).toBe("en");
    expect(useMapStore.getState().selectedParking).toEqual(en);
    const selected = useMapStore.getState().selectedParking;
    expect(selected?.type === "lot" ? selected.name : undefined).toBe("中文");
  });
  it("clears absent selection and accepts legacy setter without trusting its language", () => {
    useMapStore.getState().setSelectedParking(canonical);
    useMapStore.getState().setNearbyParking([], "en");
    expect(useMapStore.getState().selectedParking).toBeNull();
    useMapStore.getState().setNearbyParking([canonical]);
    expect(useMapStore.getState().nearbyParkingLanguage).toBeUndefined();
    expect(useMapStore.getState().nearbyParking[0]._id).toBe("id");
  });
});
