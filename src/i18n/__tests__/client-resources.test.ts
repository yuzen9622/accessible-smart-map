import { createInstance, type i18n } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../locale/en/translation.json";
import zhTW from "../locale/zh-TW/translation.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/zh-TW",
  redirect: vi.fn(),
}));
vi.mock("@/stores/useAuthStore", () => ({ default: vi.fn() }));

let instance: i18n;
beforeEach(async () => {
  vi.resetModules();
  instance = createInstance();
  vi.doMock("i18next", () => ({ default: instance }));
});
afterEach(() => vi.doUnmock("i18next"));

describe("client translation resources after a module refresh", () => {
  it.each(["zh-TW", "en"] as const)(
    "refreshes existing %s resources without resetting the chosen language",
    async (language) => {
      await instance.init({
        lng: language,
        fallbackLng: "zh-TW",
        resources: {
          "zh-TW": { translation: { routeOutdoorSection: "舊文案" } },
          en: { translation: { routeOutdoorSection: "Old copy" } },
        },
      });
      const changeLanguage = vi.spyOn(instance, "changeLanguage");
      const init = vi.spyOn(instance, "init");
      const resourceStore = instance.services.resourceStore;
      const translate = instance.getFixedT(language);
      const { default: client } = await import("../client");
      const dict = language === "en" ? en : zhTW;
      expect(client).toBe(instance);
      expect(client.services.resourceStore).toBe(resourceStore);
      expect(client.language).toBe(language);
      expect(client.t("walkToDestination", { destination: "Room A" })).toBe(
        dict.walkToDestination.replace("{{destination}}", "Room A"),
      );
      expect(client.t("routeOutdoorSection")).toBe(dict.routeOutdoorSection);
      expect(translate("routeOutdoorSection")).toBe(dict.routeOutdoorSection);
      expect(init).not.toHaveBeenCalled();
      expect(changeLanguage).not.toHaveBeenCalled();
      // Both bundles update, so a subsequent UI-language switch uses new copy too.
      const other = language === "en" ? "zh-TW" : "en";
      expect(
        client.getFixedT(other)("venueArriveAt", { destination: "Room A" }),
      ).toBe(
        (other === "en" ? en : zhTW).venueArriveAt.replace(
          "{{destination}}",
          "Room A",
        ),
      );
      const added = vi.fn();
      resourceStore.on("added", added);
      vi.resetModules();
      await import("../client");
      expect(added).not.toHaveBeenCalled();
    },
  );
});
