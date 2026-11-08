import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  url: new URL("https://map.example/map/"),
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial;
    return [
      harness.slots[index],
      (value: unknown) => {
        harness.slots[index] = value;
      },
    ];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = harness.cursor++;
    const previous = harness.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => dep !== previous[i])) {
      harness.slots[index] = deps;
      harness.effects.push(effect);
    }
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => harness.url.pathname,
  useSearchParams: () => harness.url.searchParams,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import AuthLinkDialog from "../AuthLinkDialog";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: string;
};
function render(): DialogProps {
  harness.cursor = 0;
  const element = AuthLinkDialog() as ReactElement<DialogProps>;
  const effects = harness.effects.splice(0);
  for (const effect of effects) effect();
  return effects.length ? render() : element.props;
}
beforeEach(() => {
  harness.url = new URL("https://map.example/map/");
  harness.slots = [];
  harness.effects = [];
  vi.stubGlobal("window", {
    get location() {
      return harness.url;
    },
    history: {
      replaceState: vi.fn((_state, _unused, href: string) => {
        harness.url = new URL(href, harness.url);
      }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("account deep-link dialog", () => {
  it.each(["/map/", "/zh-TW/map/", "/en/map/"])(
    "opens forgot password independently of account controls on %s",
    (path) => {
      harness.url = new URL(
        `${path}?authModal=forgot&loc=25,121#token=share`,
        harness.url,
      );
      expect(render()).toMatchObject({ open: true, initialMode: "forgot" });
      expect(harness.url.pathname).toBe(path);
      expect(harness.url.searchParams.get("authModal")).toBeNull();
      expect(harness.url.searchParams.get("loc")).toBe("25,121");
      expect(harness.url.hash).toBe("#token=share");
    },
  );
  it("stays closed on an ordinary map visit", () => {
    expect(render().open).toBe(false);
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
  it("consumes a link once and supports a later link on the same route", () => {
    harness.url.search = "?authModal=forgot";
    const dialog = render();
    dialog.onOpenChange(false);
    expect(render().open).toBe(false);
    harness.url = new URL("?authModal=forgot", harness.url);
    expect(render().open).toBe(true);
  });
});
