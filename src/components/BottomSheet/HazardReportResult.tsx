"use client";

import {
  Camera,
  CircleCheck,
  CircleHelp,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppTranslation } from "@/i18n/client";
import { confirmHazardReport, getHazardReport } from "@/lib/api/a11y";
import {
  createHazardReviewPoller,
  hazardCanConfirm,
  hazardCanResubmit,
  hazardExpired,
  hazardReviewStatus,
  type ReviewPollNotice,
} from "@/lib/hazard-review";
import { reportPresentation, reportTones } from "@/lib/report-presentation";
import useAuthStore from "@/stores/useAuthStore";
import type { HazardReport } from "@/types/route";
import { Button } from "../ui/button";
import HazardReviewDetails from "./HazardReviewDetails";

export function HazardReportResultContent({
  report,
  reportId,
  merged,
  notice,
  onRefresh,
  onResubmit,
  onConfirm,
  onNewSubmission,
  voting,
  voted,
  canVote,
}: {
  report?: HazardReport;
  reportId: string;
  merged?: boolean;
  notice: ReviewPollNotice;
  onRefresh: () => void;
  onResubmit: (report: HazardReport) => void;
  onConfirm: () => void;
  onNewSubmission?: () => void;
  voting?: boolean;
  voted?: boolean;
  canVote?: boolean;
}) {
  const { t } = useAppTranslation();
  const expired = report && hazardExpired(report);
  const presentation = report
    ? reportPresentation(report)
    : { label: "reportStateReviewing", tone: "blue" as const };
  const StatusIcon =
    presentation.tone === "green"
      ? CircleCheck
      : presentation.tone === "blue"
        ? Clock3
        : CircleHelp;
  return (
    <section className="space-y-4" aria-live="polite">
      <div
        className={`rounded-2xl border p-4 ${reportTones[presentation.tone]}`}
      >
        <div className="flex items-center gap-2.5">
          <StatusIcon className="size-5 shrink-0" />
          <h3 className="text-base font-semibold">{t(presentation.label)}</h3>
        </div>
        <p className="mt-2 text-sm leading-6">
          {t(report ? hazardReviewStatus(report) : "hazardReviewUncertain")}
        </p>
        {!expired &&
          (report?.aiReview?.reason || report?.aiVerification?.reason) && (
            <p className="mt-3 border-t border-current/15 pt-3 text-base leading-7">
              {report.aiReview?.reason || report.aiVerification?.reason}
            </p>
          )}
      </div>
      {merged && <p className="text-sm leading-6">{t("hazardReviewMerged")}</p>}
      {report && !expired && <HazardReviewDetails report={report} />}

      {notice !== "idle" && (
        <p className="rounded-xl bg-muted p-3 text-sm leading-6">
          {t(`hazardPoll_${notice}`)}
        </p>
      )}
      {!expired && (
        <Button
          variant="ghost"
          className="min-h-11 rounded-full text-muted-foreground"
          onClick={onRefresh}
        >
          <RefreshCw className="size-4" />
          {t("hazardReviewRefresh")}
        </Button>
      )}
      {!report && notice === "missing" && onNewSubmission && (
        <Button onClick={onNewSubmission}>{t("hazardReviewResubmit")}</Button>
      )}
      {report && hazardCanResubmit(report) && (
        <Button
          className="min-h-11 w-full rounded-xl"
          onClick={() => onResubmit(report)}
        >
          <Camera className="size-4" />
          {t("hazardReviewResubmit")}
        </Button>
      )}
      {report &&
        hazardCanConfirm(report) &&
        canVote &&
        (voted ? (
          <p>{t("hazardVoted")}</p>
        ) : (
          <Button disabled={voting} onClick={onConfirm}>
            {t("confirmHazard")}
          </Button>
        ))}
      <details className="text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">
          {t("hazardReportId")}
        </summary>
        <p className="break-all pb-2 font-mono">{reportId}</p>
      </details>
    </section>
  );
}

type HazardReportResultProps = {
  initial?: HazardReport;
  reportId: string;
  merged?: boolean;
  onResubmit: (report: HazardReport) => void;
  onNewSubmission?: () => void;
  onReportUpdate?: (report: HazardReport) => void;
};

export default function HazardReportResult(props: HazardReportResultProps) {
  // Reset all local state before rendering a different ID, not after an effect.
  return <HazardReportResultSession key={props.reportId} {...props} />;
}

function HazardReportResultSession({
  initial,
  reportId,
  merged,
  onResubmit,
  onNewSubmission,
  onReportUpdate,
}: HazardReportResultProps) {
  const { t } = useAppTranslation();
  const user = useAuthStore((s) => s.user);
  // Public GET deliberately omits reporterId. Keep the identity known from
  // submission locally; never require it from the public endpoint.
  const snapshot = useRef(initial);
  const knownOwner = useRef(initial?.reporterId);
  const [report, setReport] = useState(initial);
  const live = useRef(false);
  const [notice, setNotice] = useState<ReviewPollNotice>("idle");
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [now, setNow] = useState(Date.now());
  // UI expiry and legacy-stall transitions must also happen for terminal
  // reports, without making more API requests.
  useEffect(() => {
    const boundaries = [
      report?.expiredAt ? Date.parse(report.expiredAt) : Infinity,
      !report?.aiReview && report?.createdAt
        ? Date.parse(report.createdAt) + 10 * 60_000
        : Infinity,
    ].filter((time) => time > now);
    const next = Math.min(...boundaries);
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(30_000, next - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [now, report?.expiredAt, report?.createdAt, report?.aiReview]);
  const poller = useRef<ReturnType<typeof createHazardReviewPoller> | null>(
    null,
  );
  useEffect(() => {
    live.current = true;
    const instance = createHazardReviewPoller({
      initial: snapshot.current,
      visibility: document,
      load: async (signal) => {
        const response = await getHazardReport(reportId, signal);
        if (!(response.ok || response.success) || !response.data?.report)
          throw new Error("Missing report");
        return response.data.report;
      },
      onReport: (next) => {
        setReport(next);
        onReportUpdate?.(next);
      },
      onNotice: setNotice,
    });
    poller.current = instance;
    return () => {
      live.current = false;
      instance.dispose();
      poller.current = null;
    };
  }, [reportId, onReportUpdate]);
  const owner = knownOwner.current ?? report?.reporterId;
  // Keep the existing public/IP-identity voting policy. A new anonymous
  // submission's receipt locally identifies its author; public GET never does.
  const authenticatedOwner = Boolean(user?._id && owner === user._id);
  const anonymousSubmissionOwner = Boolean(
    !user?._id && !merged && owner?.startsWith("ip:"),
  );
  const canVote = !authenticatedOwner && !anonymousSubmissionOwner;
  const confirm = async () => {
    if (!canVote || !report || !hazardCanConfirm(report) || voting || voted)
      return;
    setVoting(true);
    try {
      const response = await confirmHazardReport(reportId, "confirm");
      if (!live.current) return;
      if (!(response.ok || response.success)) throw new Error("Vote failed");
      setVoted(true);
      toast.success(t("hazardVoteConfirmSuccess"));
    } catch (error) {
      if (!live.current) return;
      const reason = (error as { reason?: string }).reason;
      const messages: Record<string, string> = {
        SELF_CONFIRMATION: "hazardVoteSelfConfirmation",
        ALREADY_VOTED: "hazardVoteAlreadyVoted",
        REPORT_NOT_FOUND: "hazardVoteReportNotFound",
        REPORT_EXPIRED: "hazardVoteReportExpired",
      };
      if (reason === "ALREADY_VOTED") setVoted(true);
      toast.error(
        t(reason && messages[reason] ? messages[reason] : "hazardVoteFailed"),
      );
    } finally {
      if (live.current) setVoting(false);
    }
  };
  return (
    <HazardReportResultContent
      report={report}
      reportId={reportId}
      merged={merged}
      notice={notice}
      onRefresh={() => poller.current?.refresh()}
      onResubmit={onResubmit}
      onNewSubmission={onNewSubmission}
      onConfirm={() => void confirm()}
      voting={voting}
      voted={voted}
      canVote={canVote}
    />
  );
}
