import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) {
      hooks.slots[index] = deps;
      hooks.effects.push(() => {
        hooks.cleanups[index]?.();
        hooks.cleanups[index] = effect() ?? (() => {});
      });
    }
  },
}));
vi.mock("@/lib/config", () => ({ END_POINT: "https://backend.test/api/v1" }));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/api/hazard-photo", () => ({ getHazardPhoto: vi.fn() }));

import { getHazardPhoto } from "@/lib/api/hazard-photo";
import PublicHazardReportPhoto from "../PublicHazardReportPhoto";

const path = "/api/v1/a11y/reports/photo-a/photo/public";
let key: string | null = null;
function unmount() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanups = [];
  key = null;
}
function render(
  url: string | null = path,
  expiredAt?: string,
): ReactElement | null {
  const session = PublicHazardReportPhoto({ publicPhotoUrl: url, expiredAt });
  if (!session || typeof session.type !== "function") {
    unmount();
    return session;
  }
  if (session.key !== key) {
    unmount();
    key = session.key;
  }
  hooks.cursor = 0;
  const props = session.props;
  const tree = (session.type as (input: typeof props) => ReactElement)(props);
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function imageEvent(
  tree: ReactElement<Record<string, unknown>>[],
  event: "onLoad" | "onError",
) {
  const handler = tree.find((node) => node.type === "img")?.props[event];
  if (typeof handler !== "function") throw new Error(`Missing image ${event}`);
  handler();
}
afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("anonymous public report photo", () => {
  it("null renders nothing and never invokes the private transport", () => {
    expect(render(null)).toBeNull();
    expect(getHazardPhoto).not.toHaveBeenCalled();
  });
  it("renders the backend public route directly with no auth token or blob", () => {
    const image = nodes(render()).find((node) => node.type === "img");
    expect(image?.props.src).toBe(`https://backend.test${path}`);
    expect(image?.props.referrerPolicy).toBe("no-referrer");
    expect(image?.props.alt).toBe("hazardPhoto");
    expect(getHazardPhoto).not.toHaveBeenCalled();
  });
  it("shows loading until actual image decoding succeeds", () => {
    const first = nodes(render());
    expect(
      first.some((node) => node.props.children === "hazardPhotoLoading"),
    ).toBe(true);
    imageEvent(first, "onLoad");
    expect(nodes(render()).some((node) => node.props.role === "status")).toBe(
      false,
    );
  });
  it("404/image error removes the image, reports non-public status, and never retries private/auth", () => {
    const first = nodes(render());
    imageEvent(first, "onError");
    const failed = nodes(render());
    expect(
      failed.some(
        (node) => node.props.children === "hazardPublicPhotoUnavailable",
      ),
    ).toBe(true);
    expect(
      failed.some(
        (node) =>
          node.type === "img" || node.type === "button" || node.type === "a",
      ),
    ).toBe(false);
    expect(getHazardPhoto).not.toHaveBeenCalled();
  });
  it("changing or revoking the DTO URL discards the old image/error session", () => {
    imageEvent(nodes(render()), "onError");
    expect(nodes(render()).some((node) => node.type === "img")).toBe(false);
    const next = nodes(render("/api/v1/a11y/reports/photo-b/photo/public"));
    expect(next.find((node) => node.type === "img")?.props.src).toContain(
      "photo-b/photo/public",
    );
    expect(
      next.some((node) => node.props.children === "hazardPhotoLoading"),
    ).toBe(true);
    expect(render(null)).toBeNull();
  });
  it("removes already-loaded pixels exactly at expiry even if the parent has not refreshed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const expires = new Date(2_000).toISOString();
    imageEvent(nodes(render(path, expires)), "onLoad");
    expect(
      nodes(render(path, expires)).some((node) => node.type === "img"),
    ).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(render(path, expires)).toBeNull();
  });
  it("never requests already-expired or private-route URLs", () => {
    expect(render(path, new Date(Date.now() - 1).toISOString())).toBeNull();
    expect(
      nodes(render("/api/v1/a11y/reports/photo-a/photo")).some(
        (node) => node.type === "img",
      ),
    ).toBe(false);
    expect(getHazardPhoto).not.toHaveBeenCalled();
  });
  it("clears its expiry timer on unmount", () => {
    vi.useFakeTimers();
    render(path, new Date(Date.now() + 10_000).toISOString());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
