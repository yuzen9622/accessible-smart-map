import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HazardReport } from "@/types/route";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  epoch: 0,
  location: { lat: 25, lng: 121 },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: value };
    return hooks.slots[index];
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
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/stores/useMapStore", () => ({
  default: (selector: (state: unknown) => unknown) =>
    selector({ userLocation: hooks.location, map: null }),
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: (selector: (state: unknown) => unknown) => selector({ user: null }),
}));
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: (selector: (state: unknown) => unknown) =>
    selector({ accountEpoch: hooks.epoch, revision: 0 }),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/api/a11y", () => ({
  getNearbyHazardReports: vi.fn(),
  getHazardReport: vi.fn(),
  confirmHazardReport: vi.fn(),
}));

import PublicHazardReportPhoto from "@/components/BottomSheet/PublicHazardReportPhoto";
import { getHazardReport, getNearbyHazardReports } from "@/lib/api/a11y";
import HazardWrapper from "../HazardWrapper";

const queued: HazardReport = {
  _id: "6670abc123def4567890abcd",
  hazardType: "obstacle",
  status: "pending",
  publicPhotoUrl: null,
  reportedLocation: { type: "Point", coordinates: [121, 25] },
  hasPhoto: true,
  aiReview: {
    version: 2,
    state: "queued",
    reasonCode: "TEST",
    reason: "Pending",
  },
};
const approved: HazardReport = {
  ...queued,
  status: "verified",
  publicPhotoUrl: `/api/v1/a11y/reports/${queued._id}/photo/public`,
  aiReview: {
    version: 2,
    state: "completed",
    decision: "supported",
    reasonCode: "TEST",
    reason: "Photo supports report",
  },
};
const envelope = (report: HazardReport) =>
  ({ ok: true, data: { report } }) as Awaited<
    ReturnType<typeof getHazardReport>
  >;
let mountedKey: string | null = null;
function unmount() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanups = [];
  mountedKey = null;
}
function render(): ReactElement | null {
  const session = HazardWrapper();
  if (mountedKey !== session.key) {
    unmount();
    mountedKey = session.key;
  }
  hooks.cursor = 0;
  const props = session.props;
  const tree = (session.type as (input: typeof props) => ReactElement | null)(
    props,
  );
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
async function open(report: HazardReport) {
  vi.useFakeTimers();
  const visibility = new EventTarget() as EventTarget & { hidden: boolean };
  visibility.hidden = false;
  vi.stubGlobal("document", visibility);
  vi.mocked(getNearbyHazardReports).mockResolvedValue({
    ok: true,
    data: { reports: [report], total: 1 },
  } as Awaited<ReturnType<typeof getNearbyHazardReports>>);
  render();
  await flush();
  const button = nodes(render()).find(
    (node) => node.type === "button" && node.props["aria-label"] === "obstacle",
  );
  if (!button) throw new Error("Missing hazard marker");
  (button.props.onClick as (event: unknown) => void)({
    stopPropagation: vi.fn(),
  });
  render();
  await flush();
  return render();
}
afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  hooks.epoch = 0;
});
describe("public map report refresh lifecycle", () => {
  it("refreshes the DTO on open and obtains a public URL when bounded AI polling completes", async () => {
    vi.mocked(getHazardReport)
      .mockResolvedValueOnce(envelope(queued))
      .mockResolvedValueOnce(envelope(approved));
    expect(
      nodes(await open(queued)).some(
        (node) => node.type === PublicHazardReportPhoto,
      ),
    ).toBe(false);
    expect(getHazardReport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    const photo = nodes(render()).find(
      (node) => node.type === PublicHazardReportPhoto,
    );
    expect(photo?.props.publicPhotoUrl).toBe(approved.publicPhotoUrl);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getHazardReport).toHaveBeenCalledTimes(2);
  });
  it("fresh null revokes a previously displayed URL even when hasPhoto remains true", async () => {
    vi.mocked(getHazardReport).mockResolvedValueOnce(
      envelope({ ...approved, publicPhotoUrl: null }),
    );
    expect(
      nodes(await open(approved)).some(
        (node) => node.type === PublicHazardReportPhoto,
      ),
    ).toBe(false);
  });
  it("hides expired pixels immediately and refreshes the DTO at expiry", async () => {
    const report = {
      ...approved,
      expiredAt: new Date(Date.now() + 2_000).toISOString(),
    };
    vi.mocked(getHazardReport)
      .mockResolvedValueOnce(envelope(report))
      .mockResolvedValueOnce(
        envelope({ ...report, status: "expired", publicPhotoUrl: null }),
      );
    expect(
      nodes(await open(report)).some(
        (node) => node.type === PublicHazardReportPhoto,
      ),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(
      nodes(render()).some((node) => node.type === PublicHazardReportPhoto),
    ).toBe(false);
    expect(getHazardReport).toHaveBeenCalledTimes(2);
  });
  it("closing aborts refresh and ignores late URL publication", async () => {
    let finish!: (
      response: Awaited<ReturnType<typeof getHazardReport>>,
    ) => void;
    vi.mocked(getHazardReport).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const tree = await open(queued);
    const signal = vi.mocked(getHazardReport).mock.calls[0][1];
    const close = nodes(tree).find(
      (node) => node.props["aria-label"] === "hazardReviewClose",
    );
    if (!close) throw new Error("Missing close button");
    (close.props.onClick as () => void)();
    render();
    expect(signal?.aborted).toBe(true);
    finish(envelope(approved));
    await flush();
    expect(
      nodes(render()).some((node) => node.type === PublicHazardReportPhoto),
    ).toBe(false);
  });
  it("account epoch changes discard the selected photo and abort old-account refresh", async () => {
    vi.mocked(getHazardReport).mockReturnValueOnce(new Promise(() => {}));
    await open(approved);
    const signal = vi.mocked(getHazardReport).mock.calls[0][1];
    hooks.epoch++;
    expect(
      nodes(render()).some((node) => node.type === PublicHazardReportPhoto),
    ).toBe(false);
    expect(signal?.aborted).toBe(true);
  });
});
