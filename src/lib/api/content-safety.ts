import { getAppLanguage } from "@/i18n/language";
import { END_POINT } from "@/lib/config";
import { ApiError, authenticatedRequest } from "@/lib/fetch";
import { captureSafetyAccount } from "@/stores/useContentSafetyStore";
import type { ApiResponse } from "@/types/response";

export const CONTENT_REPORT_REASONS = [
  "inappropriate_image",
  "harassment",
  "personal_information",
  "spam",
  "misinformation",
  "other",
] as const;
export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];
export type ContentTarget = {
  targetType: "review" | "hazard_report";
  targetId: string;
};
export type ContentReportReceipt = {
  caseNumber: string;
  receivedAt: string;
  confirmationEmail: "queued" | "unavailable";
  duplicate: boolean;
};
export type BlockedUser = {
  blockId: string;
  label: "review" | "hazard_report";
  createdAt: string;
};
const BASE = `${END_POINT}/api/v1`;

async function request<T>(
  path: string,
  method: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const isCurrentSession = captureSafetyAccount();
  const response = (await authenticatedRequest(`${BASE}${path}`, {
    method,
    body,
    signal,
    isCurrentSession,
    preserveSessionOnForbidden: true,
  })) as ApiResponse<T>;
  if (!isCurrentSession())
    throw new DOMException("Account changed", "AbortError");
  if (!(response.ok || response.success))
    throw new ApiError(response.message, response.code);
  return response.data as T;
}

export function submitContentReport(
  target: ContentTarget,
  reason: ContentReportReason,
  details: string,
) {
  return request<ContentReportReceipt>("/content-reports", "POST", {
    ...target,
    reason,
    details: details.trim() || undefined,
    language: getAppLanguage(),
  });
}
export function blockContentAuthor(target: ContentTarget) {
  return request<unknown>("/user/blocks", "PUT", target);
}
export function listBlockedUsers(signal?: AbortSignal) {
  return request<{ items: BlockedUser[] }>(
    "/user/blocks",
    "GET",
    undefined,
    signal,
  );
}
export function unblockUser(blockId: string) {
  return request<unknown>(
    `/user/blocks/${encodeURIComponent(blockId)}`,
    "DELETE",
  );
}
