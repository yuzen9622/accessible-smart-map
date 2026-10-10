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
import useAuthStore from "@/stores/useAuthStore";
import useContentSafetyStore from "@/stores/useContentSafetyStore";
import type {
  PlaceReviewType,
  ReviewItem,
  ReviewSummaryResult,
} from "@/types/review";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

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
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={`transition-colors ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
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
  const [submitting, setSubmitting] = useState(false);

  // Identifies the place whose data is currently loaded, so async
  // continuations can bail if the user switched places mid-request.
  const placeKey = `${placeId}|${placeType}`;
  const activePlaceKeyRef = useRef(placeKey);

  const ownReview = useMemo(
    () => (user ? (reviews.find((r) => r.userId === user._id) ?? null) : null),
    [reviews, user],
  );

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const [listRes, summaryRes] = await Promise.all([
          getPlaceReviews(
            { placeId, placeType, page: 1, limit: PAGE_SIZE },
            signal,
          ),
          getReviewSummary({ placeId, placeType }, signal),
        ]);
        if (signal?.aborted) return;
        if (listRes.ok && listRes.data) {
          setReviews(listRes.data.items);
          setTotalCount(listRes.data.totalCount);
          setTotalPages(listRes.data.totalPages);
          setPage(listRes.data.page);
        }
        if (summaryRes.ok && summaryRes.data) setSummary(summaryRes.data);
      } catch {
        if (!signal?.aborted) toast.error(t("reviewLoadError"));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [placeId, placeType, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    activePlaceKeyRef.current = placeKey;
    // reset per place
    setReviews([]);
    setSummary(null);
    setTotalCount(0);
    setPage(1);
    setShowForm(false);
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
    loadFirstPage(controller.signal);
    return () => {
      activePlaceKeyRef.current = "";
      controller.abort();
    };
  }, [loadFirstPage, placeKey]);

  const handleLoadMore = useCallback(async () => {
    if (page >= totalPages) return;
    const requestedKey = placeKey;
    setLoadingMore(true);
    try {
      const res = await getPlaceReviews({
        placeId,
        placeType,
        page: page + 1,
        limit: PAGE_SIZE,
      });
      // Bail if the user switched places while this request was in flight.
      if (activePlaceKeyRef.current !== requestedKey) return;
      if (res.ok && res.data) {
        const data = res.data;
        setReviews((prev) => [...prev, ...data.items]);
        setPage(data.page);
        setTotalPages(data.totalPages);
      }
    } catch {
      if (activePlaceKeyRef.current === requestedKey) {
        toast.error(t("reviewLoadError"));
      }
    } finally {
      if (activePlaceKeyRef.current === requestedKey) setLoadingMore(false);
    }
  }, [placeId, placeType, page, totalPages, placeKey, t]);

  const openCreateForm = useCallback(() => {
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((review: ReviewItem) => {
    setEditingId(review._id);
    setRatings(fromReview(review));
    setComment(review.comment ?? "");
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setRatings(EMPTY_RATINGS);
    setComment("");
  }, []);

  const handleSubmit = useCallback(async () => {
    const allRated = RATING_KEYS.every(
      (k) => Number.isInteger(ratings[k]) && ratings[k] >= 1 && ratings[k] <= 5,
    );
    if (!allRated) {
      toast.error(t("reviewRatingRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const backendRatings = toBackendRatings(ratings);
      const trimmed = comment.trim();
      if (trimmed.length > 500) {
        toast.error("評語不得超過 500 字");
        return;
      }
      if (editingId) {
        const res = await updateReview(editingId, {
          ...backendRatings,
          comment: trimmed || undefined,
        });
        if (res.ok) toast.success(t("reviewUpdated"));
      } else {
        const res = await createReview({
          placeId,
          placeType,
          ...backendRatings,
          comment: trimmed || undefined,
        });
        if (res.ok) toast.success(t("reviewSubmitted"));
      }
      closeForm();
      await loadFirstPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("reviewSubmitError"));
    } finally {
      setSubmitting(false);
    }
  }, [
    ratings,
    comment,
    editingId,
    placeId,
    placeType,
    closeForm,
    loadFirstPage,
    t,
  ]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t("reviewDeleteConfirm"))) return;
      try {
        const res = await deleteReview(id);
        if (res.ok) {
          toast.success(t("reviewDeleted"));
          if (editingId === id) closeForm();
          await loadFirstPage();
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("reviewSubmitError"),
        );
      }
    },
    [editingId, closeForm, loadFirstPage, t],
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
            className="rounded-full"
            onClick={requestAuthDialog}
          >
            {t("loginRegisterCta")}
          </Button>
        </div>
      ) : !showForm ? (
        <Button
          variant="outline"
          size="sm"
          onClick={ownReview ? () => openEditForm(ownReview) : openCreateForm}
          className="w-full rounded-xl mb-3 gap-1.5"
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
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t(key)}</span>
              <StarRating
                value={ratings[key]}
                onChange={(v) => setRatings((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}
          <textarea
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
              className="flex-1 rounded-xl"
            >
              {t("cancel") || "取消"}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl gap-1.5"
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
                {review.comment && (
                  <p className="text-sm leading-relaxed">{review.comment}</p>
                )}
                {isOwn && (
                  <div className="flex items-center gap-3 pt-0.5">
                    <button
                      type="button"
                      onClick={() => openEditForm(review)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      {t("edit") || "編輯"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(review._id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
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
              className="w-full rounded-xl gap-1.5"
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
