"use client";

import {
  Loader2,
  MessageSquare,
  Pencil,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import ContentSafetyMenu from "@/components/content-safety/ContentSafetyMenu";
import { useAppTranslation } from "@/i18n/client";
import {
  createReview,
  deleteReview,
  getPlaceReviews,
  getReviewSummary,
  updateReview,
} from "@/lib/api/review";
import {
  fromReviewEvidence,
  reviewText,
  toEvidencePayload,
} from "@/lib/reviewEvidence";
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore from "@/stores/useContentSafetyStore";
import type {
  PlaceReviewType,
  ReviewItem,
  ReviewSummaryResult,
} from "@/types/review";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ReviewEvidenceDetails, ReviewEvidenceFields } from "./ReviewEvidence";

interface RatingForm {
  passageWidth: number;
  restroomQuality: number;
  elevatorCondition: number;
  serviceAttitude: number;
}

const EMPTY_RATINGS: RatingForm = {
  passageWidth: 0,
  restroomQuality: 0,
  elevatorCondition: 0,
  serviceAttitude: 0,
};

const RATING_KEYS: (keyof RatingForm)[] = [
  "passageWidth",
  "restroomQuality",
  "elevatorCondition",
  "serviceAttitude",
];

// UI form keys -> backend rating fields
function toBackendRatings(r: RatingForm) {
  return {
    passageWidthRating: r.passageWidth,
    toiletRating: r.restroomQuality,
    elevatorRating: r.elevatorCondition,
    serviceRating: r.serviceAttitude,
  };
}

function fromReview(r: ReviewItem): RatingForm {
  return {
    passageWidth: r.passageWidthRating,
    restroomQuality: r.toiletRating,
    elevatorCondition: r.elevatorRating,
    serviceAttitude: r.serviceRating,
  };
}

function StarRating({
  value,
  onChange,
  readonly = false,
  label = "",
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  label?: string;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          aria-label={`${label} ${star}/5`}
          aria-pressed={star === value}
          onClick={() => onChange?.(star)}
          className={`min-h-11 min-w-11 flex items-center justify-center transition-colors ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
        >
          <Star
            className={`h-4 w-4 ${
              star <= value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

const PAGE_SIZE = 10;

export default function PlaceReviewSection(props: {
  placeId: string;
  placeType: PlaceReviewType;
}) {
  const epoch = useContentSafetyStore((s) => s.accountEpoch);
  const revision = useContentSafetyStore((s) => s.revision);
  return (
    <PlaceReviewSession
      key={`${props.placeId}:${props.placeType}:${epoch}:${revision}`}
      {...props}
    />
  );
}

function PlaceReviewSession({
  placeId,
  placeType,
}: {
  placeId: string;
  placeType: PlaceReviewType;
}) {
  const { t } = useAppTranslation();
  const { user, requestAuthDialog } = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      requestAuthDialog: s.requestAuthDialog,
    })),
  );

  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState<ReviewSummaryResult | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<RatingForm>(EMPTY_RATINGS);
  const [comment, setComment] = useState("");
  const [evidence, setEvidence] = useState(() => fromReviewEvidence());
  const [persistedEvidence, setPersistedEvidence] = useState(() =>
    fromReviewEvidence(),
  );
  const busyRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // Identifies the place whose data is currently loaded, so async
  // continuations can bail if the user switched places mid-request.
  const placeKey = `${placeId}|${placeType}`;
  const activePlaceKeyRef = useRef(placeKey);
  const safetyIdentity = useRef(useContentSafetyStore.getState());
  const generation = useRef(0);
  const captureSession = useCallback(() => {
    const version = generation.current;
    return () =>
      activePlaceKeyRef.current === placeKey &&
      generation.current === version &&
      safetyIdentity.current.accountEpoch ===
        useContentSafetyStore.getState().accountEpoch &&
      safetyIdentity.current.revision ===
        useContentSafetyStore.getState().revision;
  }, [placeKey]);

  const ownReview = useMemo(
    () => (user ? (reviews.find((r) => r.userId === user._id) ?? null) : null),
    [reviews, user],
  );

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      const isCurrent = captureSession();
      if (!isCurrent()) return;
      setLoading(true);
      try {
        const [listRes, summaryRes] = await Promise.all([
          getPlaceReviews(
            { placeId, placeType, page: 1, limit: PAGE_SIZE },
            signal,
          ),
          getReviewSummary({ placeId, placeType }, signal),
        ]);
        if (signal?.aborted || !isCurrent()) return;
        if (listRes.ok && listRes.data) {
          setReviews(listRes.data.items);
          setTotalCount(listRes.data.totalCount);
          setTotalPages(listRes.data.totalPages);
          setPage(listRes.data.page);
        }
        if (summaryRes.ok && summaryRes.data) setSummary(summaryRes.data);
      } catch {
        if (!signal?.aborted && isCurrent()) toast.error(t("reviewLoadError"));
      } finally {
        if (!signal?.aborted && isCurrent()) setLoading(false);
      }
    },
    [placeId, placeType, t, captureSession],
  );

  useEffect(() => {
    const controller = new AbortController();
    activePlaceKeyRef.current = placeKey;
    generation.current++;
    busyRef.current = false;
    setSubmitting(false);
    setLoadingMore(false);
    // reset per place
    setReviews([]);
    setSummary(null);
    setTotalCount(0);
    setPage(1);
    setShowForm(false);
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
    setEvidence(fromReviewEvidence());
    setPersistedEvidence(fromReviewEvidence());
    loadFirstPage(controller.signal);
    return () => {
      generation.current++;
      activePlaceKeyRef.current = "";
      controller.abort();
    };
  }, [loadFirstPage, placeKey]);

  const handleLoadMore = useCallback(async () => {
    if (page >= totalPages) return;
    const isCurrent = captureSession();
    if (!isCurrent()) return;
    setLoadingMore(true);
    try {
      const res = await getPlaceReviews({
        placeId,
        placeType,
        page: page + 1,
        limit: PAGE_SIZE,
      });
      // Bail if the user switched places while this request was in flight.
      if (!isCurrent()) return;
      if (res.ok && res.data) {
        const data = res.data;
        setReviews((prev) => [...prev, ...data.items]);
        setPage(data.page);
        setTotalPages(data.totalPages);
      }
    } catch {
      if (isCurrent()) {
        toast.error(t("reviewLoadError"));
      }
    } finally {
      if (isCurrent()) setLoadingMore(false);
    }
  }, [placeId, placeType, page, totalPages, captureSession, t]);

  const openCreateForm = useCallback(() => {
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
    setEvidence(fromReviewEvidence());
    setPersistedEvidence(fromReviewEvidence());
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((review: ReviewItem) => {
    setEditingId(review._id);
    setRatings(fromReview(review));
    setEvidence(fromReviewEvidence(review));
    setPersistedEvidence(fromReviewEvidence(review));
    setComment(review.comment ?? "");
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
    setEvidence(fromReviewEvidence());
    setPersistedEvidence(fromReviewEvidence());
  }, []);

  const handleSubmit = useCallback(async () => {
    const allRated = RATING_KEYS.every(
      (k) => Number.isInteger(ratings[k]) && ratings[k] >= 1 && ratings[k] <= 5,
    );
    if (!allRated) {
      toast.error(t("reviewRatingRequired"));
      return;
    }
    const isCurrent = captureSession();
    if (busyRef.current || !isCurrent()) return;
    const trimmed = comment.trim();
    if (trimmed.length > 500) {
      toast.error(reviewText(t, "nativeReviewTooLong"));
      return;
    }
    busyRef.current = true;
    setSubmitting(true);
    try {
      const body = {
        ...toBackendRatings(ratings),
        ...toEvidencePayload(evidence),
        comment: trimmed || undefined,
      };
      const res = editingId
        ? await updateReview(editingId, body, isCurrent)
        : await createReview({ placeId, placeType, ...body }, isCurrent);
      if (!isCurrent()) return;
      if (!res.ok) {
        toast.error(t("reviewSubmitError"));
        return;
      }
      toast.success(t(editingId ? "reviewUpdated" : "reviewSubmitted"));
      closeForm();
      await loadFirstPage();
    } catch (err) {
      if (isCurrent())
        toast.error(
          err instanceof Error ? err.message : t("reviewSubmitError"),
        );
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setSubmitting(false);
      }
    }
  }, [
    ratings,
    evidence,
    comment,
    editingId,
    placeId,
    placeType,
    closeForm,
    loadFirstPage,
    t,
    captureSession,
  ]);

  const handleDelete = useCallback(
    async (id: string) => {
      const isCurrent = captureSession();
      if (
        busyRef.current ||
        !isCurrent() ||
        !window.confirm(t("reviewDeleteConfirm"))
      )
        return;
      busyRef.current = true;
      setSubmitting(true);
      try {
        const res = await deleteReview(id, isCurrent);
        if (!isCurrent()) return;
        if (res.ok) {
          toast.success(t("reviewDeleted"));
          if (editingId === id) closeForm();
          await loadFirstPage();
        } else toast.error(t("reviewSubmitError"));
      } catch (err) {
        if (isCurrent())
          toast.error(
            err instanceof Error ? err.message : t("reviewSubmitError"),
          );
      } finally {
        if (isCurrent()) {
          busyRef.current = false;
          setSubmitting(false);
        }
      }
    },
    [editingId, closeForm, loadFirstPage, t, captureSession],
  );

  const avgRating = summary?.avgRating ?? null;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-4 w-4" />
          {t("reviewTitle")}
          {totalCount > 0 && (
            <Badge variant="secondary" className="text-xs ml-1">
              {totalCount}
            </Badge>
          )}
        </h2>
        {avgRating != null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {avgRating.toFixed(1)}
          </div>
        )}
      </div>

      {/* AI summary */}
      {summary?.summary && (
        <div className="rounded-xl bg-primary/5 border border-primary/10 p-3 mb-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {t("reviewAiSummary")}
          </div>
          <p className="text-sm leading-relaxed">{summary.summary}</p>
          {summary.highlights && summary.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {summary.highlights.map((h) => (
                <Badge key={h} variant="secondary" className="text-xs">
                  {h}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Write / edit review button + form */}
      {!user ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 p-3 mb-3 text-center">
          <p className="text-sm text-muted-foreground">
            {t("reviewLoginRequired")}
          </p>
          <Button
            size="sm"
            className="min-h-11 rounded-full"
            onClick={requestAuthDialog}
          >
            {t("loginRegisterCta")}
          </Button>
        </div>
      ) : !showForm ? (
        <Button
          variant="outline"
          size="sm"
          disabled={submitting}
          onClick={ownReview ? () => openEditForm(ownReview) : openCreateForm}
          className="min-h-11 w-full rounded-xl mb-3 gap-1.5"
        >
          {ownReview ? (
            <Pencil className="h-3.5 w-3.5" />
          ) : (
            <Star className="h-3.5 w-3.5" />
          )}
          {ownReview ? t("reviewEditYours") : t("writeReview")}
        </Button>
      ) : (
        <div className="rounded-xl bg-muted/30 p-3 space-y-3 mb-3">
          {RATING_KEYS.map((key) => (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-1"
            >
              <span className="text-xs text-muted-foreground">{t(key)}</span>
              <StarRating
                value={ratings[key]}
                label={t(key)}
                readonly={submitting}
                onChange={(v) => setRatings((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}
          <ReviewEvidenceFields
            value={evidence}
            persisted={persistedEvidence}
            onChange={setEvidence}
            disabled={submitting}
            t={t}
          />
          <textarea
            disabled={submitting}
            aria-label={t("reviewPlaceholder")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            placeholder={t("reviewPlaceholder")}
            className="w-full text-sm bg-background border border-border rounded-lg p-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={closeForm}
              disabled={submitting}
              className="min-h-11 flex-1 rounded-xl"
            >
              {t("cancel") || "取消"}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
              className="min-h-11 flex-1 rounded-xl gap-1.5"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editingId ? t("reviewUpdate") : t("submitReview")}
            </Button>
          </div>
        </div>
      )}

      {/* Review list */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length > 0 ? (
        <div className="space-y-2">
          {reviews.map((review) => {
            const isOwn = user?._id === review.userId;
            return (
              <div
                key={review._id}
                className="rounded-xl bg-muted/40 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {isOwn ? t("reviewYou") : t("reviewUser")}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="text-xs text-muted-foreground">
                        {review.rating.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </span>
                    <ContentSafetyMenu
                      target={{ targetType: "review", targetId: review._id }}
                      isOwn={isOwn}
                      canBlock={Boolean(review.userId)}
                    />
                  </div>
                </div>
                <ReviewEvidenceDetails review={review} t={t} />
                {review.comment && (
                  <p className="text-sm leading-relaxed">{review.comment}</p>
                )}
                {isOwn && (
                  <div className="flex items-center gap-3 pt-0.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => openEditForm(review)}
                      className="min-h-11 min-w-11 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      {t("edit") || "編輯"}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDelete(review._id)}
                      className="min-h-11 min-w-11 flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("reviewDelete")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {page < totalPages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="min-h-11 w-full rounded-xl gap-1.5"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("reviewLoadMore")}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-2">{t("noReviews")}</p>
      )}
    </section>
  );
}
