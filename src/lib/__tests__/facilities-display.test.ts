import { describe, expect, it } from "vitest";
import { A11yEnum, type IBathroom, type metroA11yData } from "@/types";
import { formatBathroom, formatMetroA11y } from "../utils";

describe("facility marker display is presentation only", () => {
  it("prefers nonempty display and keeps canonical names, same-name distinct IDs and coordinates", () => {
    const rows = [
      {
        _id: "one",
        name: "中文廁所",
        displayName: "Accessible toilet",
        location: { type: "Point", coordinates: [121, 25] },
      },
      {
        _id: "two",
        name: "中文廁所",
        displayName: "  ",
        location: { type: "Point", coordinates: [122, 26] },
      },
    ] as IBathroom[];
    const original = structuredClone(rows);
    const markers = formatBathroom(rows);
    expect(markers.map((marker) => marker.id)).toEqual(["one", "two"]);
    expect(markers.map((marker) => marker.content?.title)).toEqual([
      "Accessible toilet",
      "中文廁所",
    ]);
    expect(markers[1].position).toEqual({ lng: 122, lat: 26 });
    expect(rows).toEqual(original);
  });
  it("classification still uses canonical metro name, not English display", () => {
    const rows = [
      {
        _id: "elevator",
        "出入口電梯/無障礙坡道名稱": "中文電梯",
        displayName: "English lift",
        location: { type: "Point", coordinates: [121, 25] },
      },
      {
        _id: "ramp",
        "出入口電梯/無障礙坡道名稱": "中文坡道",
        displayName: " ",
        location: { type: "Point", coordinates: [121, 25] },
      },
      {
        _id: "english-only",
        "出入口電梯/無障礙坡道名稱": "",
        displayName: "English-only ramp",
        location: { type: "Point", coordinates: [121, 25] },
      },
    ] as metroA11yData[];
    expect(
      formatMetroA11y(rows).map((marker) => [
        marker.id,
        marker.content?.title,
        marker.a11yType,
      ]),
    ).toEqual([
      ["elevator", "English lift", A11yEnum.ELEVATOR],
      ["ramp", "中文坡道", A11yEnum.RAMP],
      ["english-only", "English-only ramp", A11yEnum.RAMP],
    ]);
  });
});
