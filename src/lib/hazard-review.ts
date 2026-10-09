import type { HazardReport } from "@/types/route";

export const REVIEW_POLL_LIMIT_MS = 5 * 60_000;
export const REVIEW_REQUEST_TIMEOUT_MS = 15_000;

export function hazardExpired(report: HazardReport, now = Date.now()) {
  return (
    report.status === "expired" ||
    Boolean(report.expiredAt && Date.parse(report.expiredAt) <= now)
  );
}

export function hazardReviewStatus(
  report: HazardReport,
  now = Date.now(),
): string {
  if (hazardExpired(report, now)) return "hazardReviewExpired";
  if (report.status === "rejected") return "hazardReviewUnsupported";
  const review = report.aiReview;
  if (report.status === "verified" && review?.decision !== "supported")
    return "hazardReviewVerified";
  if (review) {
    if (review.state === "completed") {
      return review.decision === "supported"
        ? "hazardReviewSupported"
        : review.decision === "unsupported"
          ? "hazardReviewUnsupported"
          : "hazardReviewNeedsEvidence";
    }
    if (review.state === "queued" || review.state === "processing") {
      if (
        review.delayed === true ||
        (review.queuedAt &&
          now - Date.parse(review.queuedAt) >= REVIEW_POLL_LIMIT_MS)
      )
        return "hazardReviewDelayed";
      return review.state === "queued"
        ? "hazardReviewQueued"
        : "hazardReviewProcessing";
    }
    return review.state === "failed"
      ? "hazardReviewFailed"
      : "hazardReviewCancelled";
  }
  if (report.aiVerification?.verdict === "suspicious")
    return "hazardReviewNeedsEvidence";
  if (
    report.aiVerification?.verdict === "skipped" &&
    report.createdAt &&
    now - Date.parse(report.createdAt) >= 10 * 60_000
  )
    return "hazardReviewLegacyStalled";
  return "hazardReviewLegacy";
}

export function hazardCanConfirm(report: HazardReport, now = Date.now()) {
  if (hazardExpired(report, now)) return false;
  if (report.status === "verified") return true;
  if (report.status !== "pending") return false;
  if (!report.aiReview)
    return hazardReviewStatus(report, now) === "hazardReviewLegacy";
  return (
    report.aiReview.state === "queued" || report.aiReview.state === "processing"
  );
}

export function hazardCanResubmit(report: HazardReport, now = Date.now()) {
  return (
    !hazardExpired(report, now) &&
    [
      "hazardReviewNeedsEvidence",
      "hazardReviewFailed",
      "hazardReviewLegacyStalled",
    ].includes(hazardReviewStatus(report, now))
  );
}

// Deliberately excludes photos, report identity, description, votes and expiry.
export function hazardResubmitPreset(report: HazardReport) {
  return {
    hazardType: report.hazardType,
    location: {
      lat: report.reportedLocation.coordinates[1],
      lng: report.reportedLocation.coordinates[0],
    },
  };
}

export type ReviewPollNotice = "idle" | "network" | "delayed" | "missing";

/** One request at a time, including across visibility abort/resume. The absolute
 * budget is never reset by visibility changes, errors or manual refresh. */
export function createHazardReviewPoller(options: {
  initial?: HazardReport;
  load: (signal: AbortSignal) => Promise<HazardReport>;
  onReport: (report: HazardReport) => void;
  onNotice: (notice: ReviewPollNotice) => void;
  visibility: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
}) {
  let report = options.initial;
  const start = Date.now();
  const queued = report?.aiReview?.queuedAt
    ? Date.parse(report.aiReview.queuedAt)
    : start;
  const deadline = Math.min(
    start + REVIEW_POLL_LIMIT_MS,
    Number.isFinite(queued)
      ? queued + REVIEW_POLL_LIMIT_MS
      : start + REVIEW_POLL_LIMIT_MS,
  );
  let disposed = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let boundary: ReturnType<typeof setTimeout> | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let missing = false;
  let manualPending = false;

  const pending = () =>
    !report ||
    (!hazardExpired(report) &&
      report.status === "pending" &&
      (report.aiReview?.state === "queued" ||
        report.aiReview?.state === "processing"));
  const active = () =>
    pending() &&
    (!report || hazardReviewStatus(report) !== "hazardReviewDelayed");
  const cancelRequest = () => {
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = undefined;
    // Retain the controller until load settles, even if load ignores abort.
    controller?.abort();
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const budget = () => Date.now() < deadline;
  const armBoundary = () => {
    if (boundary) clearTimeout(boundary);
    const expires = report?.expiredAt ? Date.parse(report.expiredAt) : Infinity;
    const next = Math.min(deadline, expires);
    boundary = setTimeout(
      () => {
        clear();
        cancelRequest();
        if (!disposed) {
          if (report) options.onReport({ ...report });
          if (pending()) options.onNotice("delayed");
        }
      },
      Math.max(0, next - Date.now()),
    );
  };
  const schedule = () => {
    clear();
    if (disposed || options.visibility.hidden || missing || !active()) return;
    if (!budget()) {
      options.onNotice("delayed");
      return;
    }
    timer = setTimeout(
      () => void run(false),
      Date.now() - start < 30_000 ? 2000 : 5000,
    );
  };
  const run = async (manual: boolean) => {
    if (disposed || options.visibility.hidden || controller) return;
    if (!manual && (!budget() || missing || !active())) return;
    clear();
    const request = new AbortController();
    controller = request;
    requestTimer = setTimeout(() => {
      cancelRequest();
      if (!disposed && !options.visibility.hidden)
        options.onNotice(budget() ? "network" : "delayed");
    }, REVIEW_REQUEST_TIMEOUT_MS);
    try {
      const next = await options.load(request.signal);
      if (disposed || request.signal.aborted) return;
      report = next;
      missing = false;
      options.onReport(next);
      options.onNotice(
        hazardReviewStatus(next) === "hazardReviewDelayed" ? "delayed" : "idle",
      );
      if (active() && budget()) armBoundary();
      else if (boundary) clearTimeout(boundary);
    } catch (error) {
      if (disposed || request.signal.aborted) return;
      const code = (error as { code?: number }).code;
      missing = code === 404 || code === 410;
      options.onNotice(missing ? "missing" : "network");
      if (missing && boundary) clearTimeout(boundary);
    } finally {
      if (requestTimer) clearTimeout(requestTimer);
      requestTimer = undefined;
      controller = undefined;
      if (!disposed && manualPending && !options.visibility.hidden) {
        manualPending = false;
        void run(true);
      } else schedule();
    }
  };
  const visibilityChanged = () => {
    clear();
    if (options.visibility.hidden) cancelRequest();
    else schedule();
  };
  options.visibility.addEventListener("visibilitychange", visibilityChanged);
  if (active() && budget()) {
    armBoundary();
    schedule();
  } else if (pending()) options.onNotice("delayed");
  return {
    refresh() {
      if (controller) {
        manualPending = true;
        return;
      }
      void run(true);
    },
    dispose() {
      disposed = true;
      clear();
      if (boundary) clearTimeout(boundary);
      cancelRequest();
      options.visibility.removeEventListener(
        "visibilitychange",
        visibilityChanged,
      );
    },
  };
}
