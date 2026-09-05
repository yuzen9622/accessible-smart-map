import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDistance } from "@/types/route";
import { getDistanceParts, NavDistanceTicker } from "../NavDistanceTicker";

describe("getDistanceParts", () => {
  it("returns null for invalid inputs", () => {
    expect(getDistanceParts(null)).toBeNull();
    expect(getDistanceParts(undefined)).toBeNull();
    expect(getDistanceParts(Number.NaN)).toBeNull();
    expect(getDistanceParts(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("handles distances >= 100km (rounded to whole km)", () => {
    const parts = getDistanceParts(120_450);
    expect(parts).not.toBeNull();
    expect(parts?.value).toBe(120);
    expect(parts?.unit).toBe("km");
    expect(parts?.text).toBe(formatDistance(120_450));
  });

  it("handles distances >= 1km (1 decimal place km)", () => {
    const parts = getDistanceParts(1250);
    expect(parts).not.toBeNull();
    expect(parts?.value).toBe(13);
    expect(parts?.format?.(parts.value)).toBe("1.3");
    expect(parts?.unit).toBe("km");
    expect(parts?.text).toBe(formatDistance(1250));
  });

  it("handles distances < 10m (exact meter integer)", () => {
    const parts = getDistanceParts(4.2);
    expect(parts).not.toBeNull();
    expect(parts?.value).toBe(4);
    expect(parts?.unit).toBe("m");
    expect(parts?.text).toBe(formatDistance(4.2));
  });

  it("handles typical turn distances < 1km (rounded to nearest 10m)", () => {
    const parts = getDistanceParts(583);
    expect(parts).not.toBeNull();
    expect(parts?.value).toBe(580);
    expect(parts?.unit).toBe("m");
    expect(parts?.text).toBe(formatDistance(583));
  });

  it("matches formatDistance output across diverse samples", () => {
    const samples = [
      0, 5, 9, 10, 15, 87, 450, 999, 1000, 1540, 99999, 100000, 250000,
    ];
    for (const s of samples) {
      const parts = getDistanceParts(s);
      expect(parts?.text).toBe(formatDistance(s));
    }
  });
});

describe("NavDistanceTicker", () => {
  it("renders null when meters is null or undefined", () => {
    const htmlNull = renderToStaticMarkup(<NavDistanceTicker meters={null} />);
    expect(htmlNull).toBe("");

    const htmlUndef = renderToStaticMarkup(
      <NavDistanceTicker meters={undefined} />,
    );
    expect(htmlUndef).toBe("");
  });

  it("renders static markup containing readable text and unit", () => {
    const html = renderToStaticMarkup(
      <NavDistanceTicker meters={580} blur={true} duration={0.5} />,
    );
    expect(html).toContain("580");
    expect(html).toContain("m");
    expect(html).toContain('class="sr-only"');
  });

  it("renders decimal distance with km unit", () => {
    const html = renderToStaticMarkup(
      <NavDistanceTicker meters={1200} blur={true} />,
    );
    expect(html).toContain("1.2");
    expect(html).toContain("km");
  });
});
