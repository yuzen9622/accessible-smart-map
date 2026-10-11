import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HazardReport } from "@/types/route";

// Node-only focused hook driver: exercises the actual session callbacks and
// effects without introducing a DOM dependency. The outer key is asserted too.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  epoch: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  user: undefined as { _id: string } | undefined,
}));
vi.mock("@/components/content-safety/ContentSafetyMenu", () => ({
  default: () => null,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: value };
    return hooks.slots[index];
  },
  useState: (value: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = value;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] = next;
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
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: (selector: (state: { accountEpoch: number }) => unknown) =>
    selector({ accountEpoch: hooks.epoch }),
  captureSafetyAccount: () => {
    const epoch = hooks.epoch;
    return () => epoch === hooks.epoch;
  },
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: (selector: (state: unknown) => unknown) =>
    selector({ user: hooks.user }),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/a11y", () => ({
  getHazardReport: vi.fn(),
  confirmHazardReport: vi.fn(),
}));

import HazardReportResult from "@/components/BottomSheet/HazardReportResult";
import { confirmHazardReport, getHazardReport } from "@/lib/api/a11y";

type ContentProps = {
  report?: HazardReport;
  reportId: string;
  voted: boolean;
  voting: boolean;
  canVote: boolean;
  onConfirm: () => void;
  onRefresh: () => void;
};
const initial: HazardReport = {
  _id: "first",
  publicPhotoUrl: null,
  reporterId: "owner",
  hazardType: "obstacle",
  status: "pending",
  reportedLocation: { type: "Point", coordinates: [121, 25] },
  aiReview: { version: 2, state: "queued", reason: "test", reasonCode: "TEST" },
};
let mountedKey: string | null = null;
function unmount() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanups = [];
  mountedKey = null;
}
function render(reportId = "first", ...rest: [HazardReport?]) {
  const report = rest.length > 0 ? rest[0] : initial;
  const session = HazardReportResult({
    reportId,
    initial: report,
    onResubmit: vi.fn(),
  });
  if (session.key !== mountedKey) {
    unmount();
    mountedKey = session.key;
  }
  hooks.cursor = 0;
  const inner = session.type as (
    props: typeof session.props,
  ) => ReactElement<ContentProps>;
  const content = inner(session.props);
  for (const effect of hooks.effects.splice(0)) effect();
  return content.props;
}
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  hooks.epoch = 0;
});
function setup() {
  vi.useFakeTimers();
  const visibility = new EventTarget() as EventTarget & { hidden: boolean };
  visibility.hidden = false;
  vi.stubGlobal("document", visibility);
  hooks.user = { _id: "owner" };
}
describe("result session identity and reset", () => {
  it("account epoch resets votes and blocked state before rendering the same report ID", async () => {
    setup();
    hooks.user = { _id: "independent" };
    vi.mocked(confirmHazardReport).mockResolvedValue({ ok: true } as Awaited<
      ReturnType<typeof confirmHazardReport>
    >);
    render().onConfirm();
    await Promise.resolve();
    expect(render().voted).toBe(true);
    hooks.epoch++;
    expect(render("first", undefined).report).toBeUndefined();
    expect(render("first", undefined).voted).toBe(false);
  });

  it("keeps known owner after public GET omits identity without newly requiring login", async () => {
    setup();
    const publicReport = { ...initial, reporterId: undefined };
    vi.mocked(getHazardReport).mockResolvedValue({
      ok: true,
      data: { report: publicReport },
    } as Awaited<ReturnType<typeof getHazardReport>>);
    expect(render().canVote).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(render().report?.reporterId).toBeUndefined();
    expect(render().canVote).toBe(false);
    render().onConfirm();
    expect(confirmHazardReport).not.toHaveBeenCalled();
    hooks.user = undefined;
    expect(render().canVote).toBe(true);
    hooks.user = { _id: "independent" };
    expect(render().canVote).toBe(true);
  });
  it("blocks an anonymous author's own receipt but allows independent public/IP identity voting", async () => {
    setup();
    hooks.user = undefined;
    const receipt = { ...initial, reporterId: `ip:${"a".repeat(32)}` };
    vi.mocked(getHazardReport).mockResolvedValue({
      ok: true,
      data: { report: { ...receipt, reporterId: undefined } },
    } as Awaited<ReturnType<typeof getHazardReport>>);
    expect(render("first", receipt).canVote).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(render("first", receipt).canVote).toBe(false);
    render("first", receipt).onConfirm();
    expect(confirmHazardReport).not.toHaveBeenCalled();
    // A public report has no owner ID; do not add a login gate to the old API.
    expect(
      render("second", { ...receipt, _id: "second", reporterId: undefined })
        .canVote,
    ).toBe(true);
  });
  it("new ID resets report, vote and known owner before first content render", async () => {
    setup();
    hooks.user = { _id: "independent" };
    vi.mocked(confirmHazardReport).mockResolvedValue({ ok: true } as Awaited<
      ReturnType<typeof confirmHazardReport>
    >);
    render().onConfirm();
    await Promise.resolve();
    expect(render().voted).toBe(true);
    const next = { ...initial, _id: "second", reporterId: "independent" };
    const content = render("second", next);
    expect(content.report?._id).toBe("second");
    expect(content.voted).toBe(false);
    expect(content.voting).toBe(false);
    expect(content.canVote).toBe(false);
    const uncertain = render("third", undefined);
    expect(uncertain.reportId).toBe("third");
    expect(uncertain.report).toBeUndefined();
    expect(uncertain.voted).toBe(false);
    expect(uncertain.canVote).toBe(true);
  });
  it("late GET and vote from a previous ID cannot update the new session", async () => {
    setup();
    hooks.user = { _id: "independent" };
    let finishGet!: (
      value: Awaited<ReturnType<typeof getHazardReport>>,
    ) => void;
    let finishVote!: (
      value: Awaited<ReturnType<typeof confirmHazardReport>>,
    ) => void;
    vi.mocked(getHazardReport).mockImplementation(
      () =>
        new Promise((done) => {
          finishGet = done;
        }),
    );
    vi.mocked(confirmHazardReport).mockImplementation(
      () =>
        new Promise((done) => {
          finishVote = done;
        }),
    );
    render().onConfirm();
    await vi.advanceTimersByTimeAsync(2000);
    render("second", undefined);
    expect(vi.mocked(getHazardReport).mock.calls[0][1]?.aborted).toBe(true);
    finishGet({ ok: true, data: { report: initial } } as Awaited<
      ReturnType<typeof getHazardReport>
    >);
    finishVote({ ok: true } as Awaited<ReturnType<typeof confirmHazardReport>>);
    await vi.advanceTimersByTimeAsync(0);
    const content = render("second", undefined);
    expect(content.report).toBeUndefined();
    expect(content.voted).toBe(false);
    expect(content.voting).toBe(false);
  });
  it("fresh initial object for the same ID does not reset absolute polling budget", async () => {
    setup();
    vi.mocked(getHazardReport).mockResolvedValue({
      ok: true,
      data: { report: initial },
    } as Awaited<ReturnType<typeof getHazardReport>>);
    render();
    await vi.advanceTimersByTimeAsync(290_000);
    render("first", { ...initial });
    await vi.advanceTimersByTimeAsync(10_000);
    const calls = vi.mocked(getHazardReport).mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(getHazardReport).toHaveBeenCalledTimes(calls);
  });
});
