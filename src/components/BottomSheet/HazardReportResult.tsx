"use client";

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
import useAuthStore from "@/stores/useAuthStore";
import type { HazardReport } from "@/types/route";
import { Button } from "../ui/button";

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
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-3"
      aria-live="polite"
    >
      <h3 className="font-semibold">
        {t(report ? hazardReviewStatus(report) : "hazardReviewUncertain")}
      </h3>
      <p className="text-xs break-all">
        {t("hazardReportId")}: {reportId}
      </p>
      {merged && <p className="text-sm">{t("hazardReviewMerged")}</p>}
      {!expired && report?.aiReview?.reason && (
        <p className="text-sm">{report.aiReview.reason}</p>
      )}
      {!expired && !report?.aiReview && report?.aiVerification?.reason && (
        <p className="text-sm">{report.aiVerification.reason}</p>
      )}
      {!expired &&
        [...new Set(report?.aiReview?.observations)].map((text) => (
          <p key={text} className="text-sm">
            {text}
          </p>
        ))}
      {!expired &&
        [...new Set(report?.aiReview?.limitations)].map((text) => (
          <p key={text} className="text-xs text-muted-foreground">
            {text}
          </p>
        ))}
      {!expired &&
        report?.aiReview?.requiredEvidence?.map((evidence) => (
          <p key={evidence} className="text-sm">
            {t(`hazardEvidence_${evidence}`)}
          </p>
        ))}
      {notice !== "idle" && (
        <p className="text-sm">{t(`hazardPoll_${notice}`)}</p>
      )}
      {!expired && (
        <Button variant="outline" onClick={onRefresh}>
          {t("hazardReviewRefresh")}
        </Button>
      )}
      {!report && notice === "missing" && onNewSubmission && (
        <Button onClick={onNewSubmission}>{t("hazardReviewResubmit")}</Button>
      )}
      {report && hazardCanResubmit(report) && (
        <Button onClick={() => onResubmit(report)}>
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
    </section>
  );
}

type HazardReportResultProps = {
  initial?: HazardReport;
  reportId: string;
  merged?: boolean;
  onResubmit: (report: HazardReport) => void;
  onNewSubmission?: () => void;
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
      onReport: setReport,
      onNotice: setNotice,
    });
    poller.current = instance;
    return () => {
      live.current = false;
      instance.dispose();
      poller.current = null;
    };
  }, [reportId]);
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
