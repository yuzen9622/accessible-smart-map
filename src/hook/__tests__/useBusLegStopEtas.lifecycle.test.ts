import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearRouteDetailCache,
  fetchRouteDetailSnapshot,
} from "@/lib/transit/busRouteDetailCache";
import type { BusLeg } from "@/types/route";

const h = vi.hoisted(() => ({
  getBusRouteDetail: vi.fn(),
  cursor: 0,
  dirty: true,
  values: [] as unknown[],
  writes: [] as { at: number; value: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as { index: number; run: () => undefined | (() => void) }[],
}));

vi.mock("@/lib/api/transit", () => ({
  getBusRouteDetail: h.getBusRouteDetail,
}));
vi.mock("@/i18n/client", () => ({ useAppTranslation: () => ({}) }));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => "zh-TW" }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.values))
      h.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.values[index],
      (value: unknown) => {
        h.values[index] =
          typeof value === "function" ? value(h.values[index]) : value;
        h.writes.push({ at: Date.now(), value: h.values[index] });
        h.dirty = true;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.values)) h.values[index] = { current: initial };
    return h.values[index];
  },
  useEffect: (run: () => undefined | (() => void), deps: unknown[]) => {
    const index = h.cursor++;
    const previous = h.effects[index];
    if (
      !previous ||
      deps.some((value, i) => !Object.is(value, previous.deps[i]))
    ) {
      h.effects[index] = { deps, cleanup: previous?.cleanup };
      h.pending.push({ index, run });
    }
  },
}));

import { useBusLegStopEtas } from "../useBusLegStopEtas";

const leg = {
  type: "BUS",
  routeName: "82",
  tdxCity: "Taichung",
  subRouteUid: "branch",
  planContext: { routeToken: "plan", legIndex: 1 },
} as BusLeg;
const directions = [
  {
    direction: 0,
    subRouteUid: "branch",
    stops: [
      {
        seq: 1,
        name: "A",
        lat: 0,
        lng: 0,
        estimateMinutes: 3,
        statusLabel: "",
      },
    ],
  },
];
const reply = { ok: true, data: { directions } };
let output: ReturnType<typeof useBusLegStopEtas>;
let mounted = true;

function render() {
  h.cursor = 0;
  h.dirty = false;
  // biome-ignore lint/correctness/useHookAtTopLevel: The mocked hook runtime invokes a complete render after state changes.
  output = useBusLegStopEtas(leg, true, true);
  for (const { index, run } of h.pending.splice(0)) {
    h.effects[index].cleanup?.();
    h.effects[index].cleanup = run() || undefined;
  }
}

async function flush() {
  for (let i = 0; i < 30; i++) {
    if (mounted && h.dirty) render();
    await Promise.resolve();
  }
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

function unmount() {
  mounted = false;
  for (const effect of h.effects) effect?.cleanup?.();
  h.effects.length = 0;
}

function visibility(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  const listener = vi
    .mocked(document.addEventListener)
    .mock.calls.find(
      ([event]) => event === "visibilitychange",
    )?.[1] as () => void;
  listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  __clearRouteDetailCache();
  h.getBusRouteDetail.mockReset();
  h.getBusRouteDetail.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(reply), 6_000)),
  );
  h.cursor = 0;
  h.dirty = true;
  h.values.length = 0;
  h.writes.length = 0;
  h.effects.length = 0;
  h.pending.length = 0;
  mounted = true;
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useBusLegStopEtas polling", () => {
  it("refreshes immediately when polling takes over a warm nine-second-old snapshot", async () => {
    h.getBusRouteDetail.mockResolvedValueOnce(reply);
    await fetchRouteDetailSnapshot("82", "Taichung", {
      lang: "zh-TW",
      subRouteUid: "branch",
      planContext: leg.planContext,
    });
    await vi.advanceTimersByTimeAsync(9_000);
    h.getBusRouteDetail.mockResolvedValueOnce(reply);
    await flush();
    await advance(6_000);
    expect(output).toEqual({ directions, status: "ready" });
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
  });

  it("keeps realtime available across successful six-second responses", async () => {
    await flush();
    await advance(6_000);
    expect(output.directions).toEqual(directions);
    await advance(4_000);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
    await advance(6_000);
    await advance(4_000);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(3);
    await advance(6_000);
    expect(output.directions).toEqual(directions);
    expect(
      h.writes.filter(
        ({ at, value }) =>
          at >= 106_000 &&
          (value as { directions: unknown }).directions === null,
      ),
    ).toEqual([]);
  });

  it("recovers after a cold failure on the next ten-second request", async () => {
    h.getBusRouteDetail.mockResolvedValueOnce({ ok: false });
    await flush();
    expect(output).toEqual({ directions: null, status: "error" });
    await advance(10_000);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
    await advance(6_000);
    expect(output).toEqual({ directions, status: "ready" });
  });

  it("does not reenter from visibility events and stops publishing after unmount", async () => {
    await flush();
    visibility(false);
    visibility(false);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(1);
    await advance(6_000);
    visibility(false);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(1);
    await advance(4_000);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
    unmount();
    const writes = h.writes.length;
    await advance(30_000);
    expect(h.writes).toHaveLength(writes);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and refreshes when visible after the next request is due", async () => {
    await flush();
    await advance(6_000);
    visibility(true);
    await advance(20_000);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(1);
    expect(output.directions).toBeNull();
    visibility(false);
    visibility(false);
    expect(h.getBusRouteDetail).toHaveBeenCalledTimes(2);
    await advance(6_000);
    expect(output).toEqual({ directions, status: "ready" });
  });
});
