import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

const request = (path: string) =>
  new NextRequest(`https://map.yuzen.dev${path}`);
describe("marketing and map routing", () => {
  it("serves the marketing root without redirecting", () => {
    expect(middleware(request("/")).headers.get("location")).toBeNull();
    expect(
      middleware(request("/?utm_source=newsletter")).headers.get("location"),
    ).toBeNull();
  });
  it.each(["/map", "/map/"])(
    "serves %s directly without replacing its public URL",
    (path) => {
      const response = middleware(request(`${path}?a11y=1&loc=25.04,121.51`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );

  it.each([
    "loc",
    "place",
    "planToken",
    "sessionId",
    "liff.state",
    "sos",
    "token",
    "a11y",
    "authModal",
    "indoor",
    "mockgeo",
  ])("preserves legacy %s map links", (key) => {
    const response = middleware(request(`/?${key}=value&utm_source=share`));
    expect(response.headers.get("location")).toBe(
      `https://map.yuzen.dev/map/?${key}=value&utm_source=share`,
    );
  });
  it.each(["zh-TW", "en"])(
    "preserves the old %s entry and its query",
    (lng) => {
      expect(
        middleware(request(`/${lng}/?place=osm%3Anode%3A1`)).headers.get(
          "location",
        ),
      ).toBe(`https://map.yuzen.dev/${lng}/map/?place=osm%3Anode%3A1`);
    },
  );
  it.each([
    "/zh-TW/map/",
    "/en/map/",
    "/zh-TW/reset-password/?token=private",
    "/zh-TW/sos/",
    "/zh-TW/policies/privacy-policy/",
    "/landing/route-desktop.webp",
  ])("does not redirect %s", (path) => {
    expect(middleware(request(path)).headers.get("location")).toBeNull();
  });
  it("keeps unprefixed account deep links", () => {
    expect(
      middleware(request("/reset-password/?token=private")).headers.get(
        "location",
      ),
    ).toBe("https://map.yuzen.dev/zh-TW/reset-password/?token=private");
  });
});
