import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  epoch: 0,
  revision: 0,
  effects: [] as (() => (() => void) | undefined)[],
  setters: [] as ReturnType<typeof vi.fn>[],
  nearby: vi.fn(),
  parking: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => {
    const setter = vi.fn();
    fixture.setters.push(setter);
    return [value, setter];
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    fixture.effects.push(effect);
  },
  useMemo: (read: () => unknown) => read(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/hook/useFetchLocation", () => ({
  useFetchLocation: () => ({ lat: 25, lng: 121 }),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: (
    selector: (s: { accountEpoch: number; revision: number }) => unknown,
  ) => selector({ accountEpoch: fixture.epoch, revision: fixture.revision }),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (state: unknown) => unknown) =>
    selector({
      map: null,
      userLocation: { lat: 25, lng: 121 },
      a11yPlaces: [],
      selectedA11yTypes: new Set(),
      toggleA11yType: vi.fn(),
      setNearbyParking: vi.fn(),
    }),
}));
vi.mock("@/lib/api/a11y", () => ({
  getNearbyHazardReports: fixture.nearby,
  getNearbyParking: fixture.parking,
}));

import A11yPanel from "../A11yPanel";

afterEach(() => {
  fixture.epoch = 0;
  fixture.revision = 0;
  fixture.effects = [];
  fixture.setters = [];
  vi.clearAllMocks();
});
describe("A11y panel content safety boundary", () => {
  it("replaces its private list session for both account changes and block revisions", () => {
    const first = A11yPanel({});
    fixture.epoch++;
    const next = A11yPanel({});
    expect(next.key).not.toBe(first.key);
    fixture.revision++;
    expect(A11yPanel({}).key).not.toBe(next.key);
  });
  it("aborts the old nearby request and discards its late result when the session unmounts", async () => {
    let release: (value: unknown) => void = () => {};
    fixture.nearby.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fixture.parking.mockResolvedValue({ ok: true, data: [] });
    const session = A11yPanel({});
    const props = session.props;
    (session.type as (value: typeof props) => ReactElement)(props);
    const cleanup = fixture.effects[0]();
    const signal = fixture.nearby.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    cleanup?.();
    expect(signal.aborted).toBe(true);
    release({ ok: true, data: { reports: [{ _id: "old-account-hazard" }] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.setters[0]).not.toHaveBeenCalled();
  });
});
