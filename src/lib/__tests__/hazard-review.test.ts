import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHazardReviewPoller,
  hazardCanConfirm,
  hazardCanResubmit,
  hazardExpired,
  hazardResubmitPreset,
  hazardReviewStatus,
  REVIEW_REQUEST_TIMEOUT_MS,
} from "@/lib/hazard-review";
import type { HazardReport } from "@/types/route";

const report = (
  state: NonNullable<HazardReport["aiReview"]>["state"] = "queued",
  decision?: NonNullable<HazardReport["aiReview"]>["decision"],
): HazardReport => ({
  _id: "test",
  publicPhotoUrl: null,
  hazardType: "obstacle",
  status: "pending",
  reportedLocation: { type: "Point", coordinates: [121.5, 25] },
  aiReview: {
    version: 2,
    state,
    decision,
    reason: "reason",
    reasonCode: "TEST",
  },
});
function harness(
  initial = report(),
  load = vi.fn(async (_signal: AbortSignal) => initial),
) {
  const visibility = new EventTarget() as EventTarget & { hidden: boolean };
  visibility.hidden = false;
  const onReport = vi.fn();
  const onNotice = vi.fn();
  const poller = createHazardReviewPoller({
    initial,
    load,
    visibility,
    onReport,
    onNotice,
  });
  return {
    load,
    visibility,
    onReport,
    onNotice,
    poller,
    hide(hidden: boolean) {
      visibility.hidden = hidden;
      visibility.dispatchEvent(new Event("visibilitychange"));
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("review states and new evidence", () => {
  it.each([
    ["queued", undefined, "hazardReviewQueued"],
    ["processing", undefined, "hazardReviewProcessing"],
    ["completed", "supported", "hazardReviewSupported"],
    ["completed", "needs_evidence", "hazardReviewNeedsEvidence"],
    ["completed", "unsupported", "hazardReviewUnsupported"],
    ["failed", undefined, "hazardReviewFailed"],
    ["cancelled", undefined, "hazardReviewCancelled"],
  ] as const)("%s/%s is explicit", (state, decision, expected) =>
    expect(hazardReviewStatus(report(state, decision))).toBe(expected),
  );
  it("supports independent verified confirmation, not failed or evidence-pending", () => {
    expect(
      hazardCanConfirm({
        ...report("completed", "supported"),
        status: "verified",
      }),
    ).toBe(true);
    expect(hazardCanConfirm(report())).toBe(true);
    expect(hazardCanConfirm(report("failed"))).toBe(false);
    expect(hazardCanConfirm(report("completed", "needs_evidence"))).toBe(false);
  });
  it("manual verified override wins over cancelled AI", () => {
    const manual = { ...report("cancelled"), status: "verified" as const };
    expect(hazardReviewStatus(manual)).toBe("hazardReviewVerified");
    expect(hazardCanConfirm(manual)).toBe(true);
  });
  it.each(["queued", "processing"] as const)(
    "explicit delayed %s never shows recognition",
    (state) => {
      const delayed = report(state);
      delayed.aiReview!.delayed = true;
      expect(hazardReviewStatus(delayed)).toBe("hazardReviewDelayed");
    },
  );
  it("expiry wins over completed evidence and hides confirmation", () => {
    const expired = {
      ...report("completed", "supported"),
      status: "verified" as const,
      expiredAt: new Date(Date.now() - 1).toISOString(),
    };
    expect(hazardExpired(expired)).toBe(true);
    expect(hazardCanConfirm(expired)).toBe(false);
    expect(hazardReviewStatus(expired)).toBe("hazardReviewExpired");
  });
  it("legacy skipped stale is resubmittable, never a spinner", () => {
    const legacy = {
      ...report(),
      aiReview: undefined,
      createdAt: new Date(Date.now() - 600_001).toISOString(),
      aiVerification: {
        verdict: "skipped" as const,
        confidence: 0.95,
        reason: "legacy",
      },
    };
    expect(hazardReviewStatus(legacy)).toBe("hazardReviewLegacyStalled");
    expect(hazardCanResubmit(legacy)).toBe(true);
    expect(hazardCanConfirm(legacy)).toBe(false);
  });
  it("new evidence preset carries only type/location, never photo, identity/votes/expiry", () => {
    const old = {
      ...report("failed"),
      photoUrl: "private",
      expiredAt: "future",
      confirmedBy: ["user"],
    };
    expect(hazardCanResubmit(old)).toBe(true);
    expect(hazardResubmitPreset(old)).toEqual({
      hazardType: "obstacle",
      location: { lat: 25, lng: 121.5 },
    });
  });
});
describe("bounded single-flight polling", () => {
  it("explicit delayed stops automatic polling both initially and after GET", async () => {
    vi.useFakeTimers();
    const delayed = report("processing");
    delayed.aiReview!.delayed = true;
    for (const initial of [delayed, report()]) {
      const h = harness(
        initial,
        vi.fn(async () => delayed),
      );
      await vi.advanceTimersByTimeAsync(300_000);
      expect(h.load).toHaveBeenCalledTimes(initial === delayed ? 0 : 1);
      expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
      h.poller.dispose();
    }
  });
  it("manual request after auto budget has a timeout and keeps single flight until settle", async () => {
    vi.useFakeTimers();
    let resolve!: (value: HazardReport) => void;
    const old = report();
    old.aiReview!.queuedAt = new Date(Date.now() - 300_001).toISOString();
    const load = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<HazardReport>((done) => {
          resolve = done;
        }),
    );
    const h = harness(old, load);
    h.poller.refresh();
    await vi.advanceTimersByTimeAsync(REVIEW_REQUEST_TIMEOUT_MS - 1);
    expect(load.mock.calls[0][0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(load.mock.calls[0][0].aborted).toBe(true);
    expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
    h.poller.refresh();
    h.hide(true);
    h.hide(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(report("completed", "supported"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onReport).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    h.poller.dispose();
    resolve(report("failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onReport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("each automatic GET times out; a rejecting abort permits retry without resetting budget", async () => {
    vi.useFakeTimers();
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<HazardReport>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const h = harness(report(), load);
    await vi.advanceTimersByTimeAsync(2000 + REVIEW_REQUEST_TIMEOUT_MS);
    expect(load.mock.calls[0][0].aborted).toBe(true);
    expect(h.onNotice).toHaveBeenLastCalledWith("network");
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000);
    const calls = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(calls);
    expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
    h.poller.dispose();
  });
  it.each(["supported", "needs_evidence", "unsupported"] as const)(
    "queued to %s stops",
    async (decision) => {
      vi.useFakeTimers();
      const h = harness(
        report(),
        vi.fn(async () => report("completed", decision)),
      );
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.load).toHaveBeenCalledTimes(1);
      expect(h.onReport).toHaveBeenCalledWith(report("completed", decision));
      h.poller.dispose();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("processing retry to failed stops", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce(report("processing"))
      .mockResolvedValueOnce(report("failed"));
    const h = harness(report(), load);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(h.onReport).toHaveBeenLastCalledWith(report("failed"));
    h.poller.dispose();
  });
  it("never overlaps a slow request; unmount aborts and ignores late result", async () => {
    vi.useFakeTimers();
    let resolve!: (value: HazardReport) => void;
    const load = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<HazardReport>((done) => {
          resolve = done;
        }),
    );
    const h = harness(report(), load);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(1);
    h.poller.dispose();
    expect(load.mock.calls[0][0].aborted).toBe(true);
    resolve(report("completed", "supported"));
    await Promise.resolve();
    expect(h.onReport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("hidden aborts; visible resumes without accepting aborted results or overlap", async () => {
    vi.useFakeTimers();
    let resolve!: (value: HazardReport) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<HazardReport>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(report("completed", "supported"));
    const h = harness(report(), load);
    await vi.advanceTimersByTimeAsync(2000);
    h.hide(true);
    expect(load.mock.calls[0][0].aborted).toBe(true);
    h.hide(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(report("failed"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.onReport).toHaveBeenCalledTimes(1);
    expect(h.onReport).toHaveBeenCalledWith(report("completed", "supported"));
    h.poller.dispose();
  });
  it("network failure recovers, but stops at 5min and manual refresh doesn't reset budget", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(report());
    const h = harness(report(), load);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.onNotice).toHaveBeenCalledWith("network");
    await vi.advanceTimersByTimeAsync(298_000);
    const calls = load.mock.calls.length;
    expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(calls);
    h.poller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(calls + 1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(calls + 1);
    h.poller.dispose();
  });
  it.each([404, 410])(
    "%i stops automatically, allows manual refresh",
    async (code) => {
      vi.useFakeTimers();
      const h = harness(
        report(),
        vi.fn(async () => {
          throw { code };
        }),
      );
      await vi.advanceTimersByTimeAsync(300_000);
      expect(h.load).toHaveBeenCalledTimes(1);
      expect(h.onNotice).toHaveBeenCalledWith("missing");
      h.poller.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.load).toHaveBeenCalledTimes(2);
      h.poller.dispose();
    },
  );
  it("expiry aborts slow in-flight poll without waiting for next interval", async () => {
    vi.useFakeTimers();
    const initial = {
      ...report(),
      expiredAt: new Date(Date.now() + 3500).toISOString(),
    };
    const h = harness(
      initial,
      vi.fn((_signal: AbortSignal) => new Promise<HazardReport>(() => {})),
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.load.mock.calls[0][0].aborted).toBe(true);
    expect(h.onReport).toHaveBeenCalled();
    h.poller.dispose();
  });
  it("absolute 5min deadline aborts even a hung request", async () => {
    vi.useFakeTimers();
    const h = harness(
      report(),
      vi.fn((_signal: AbortSignal) => new Promise<HazardReport>(() => {})),
    );
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0][0].aborted).toBe(true);
    expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
    expect(vi.getTimerCount()).toBe(0);
    h.poller.dispose();
  });
  it("hidden time never resets the absolute budget", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.hide(true);
    await vi.advanceTimersByTimeAsync(300_000);
    h.hide(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.onNotice).toHaveBeenLastCalledWith("delayed");
    h.poller.dispose();
    h.hide(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminal/legacy reports do not start polling", async () => {
    vi.useFakeTimers();
    for (const initial of [
      report("failed"),
      { ...report(), aiReview: undefined },
      report("cancelled"),
    ]) {
      const h = harness(initial);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(h.load).not.toHaveBeenCalled();
      h.poller.dispose();
    }
  });
});
