import { END_POINT } from "@/lib/config";
import { authenticatedRequest, fetchRequest } from "@/lib/fetch";
import type { ApiResponse } from "@/types/response";
import type {
  CreateEmergencyContactResult,
  CreateSosSessionInput,
  CreateSosSessionResult,
  EmergencyContact,
  ResolveSosSessionResult,
  RotateSosShareTokenResult,
  SosPublicSession,
  SosSnapshot,
} from "@/types/sos";

const CONTACTS_BASE = `${END_POINT}/api/v1/user/emergency-contacts`;
const SOS_BASE = `${END_POINT}/api/v1/sos/sessions`;

export async function getEmergencyContacts() {
  const response = await authenticatedRequest(CONTACTS_BASE, {
    method: "GET",
  });
  return response as ApiResponse<{ contacts: EmergencyContact[] }>;
}

export async function createEmergencyContact(name: string) {
  const response = await authenticatedRequest(CONTACTS_BASE, {
    method: "POST",
    body: { name },
  });
  return response as ApiResponse<CreateEmergencyContactResult>;
}

export async function deleteEmergencyContact(id: string) {
  const response = await authenticatedRequest(`${CONTACTS_BASE}/${id}`, {
    method: "DELETE",
  });
  return response as ApiResponse<null>;
}

export async function createSosSession(input: CreateSosSessionInput) {
  const response = await authenticatedRequest(SOS_BASE, {
    method: "POST",
    body: input,
  });
  return response as ApiResponse<CreateSosSessionResult>;
}

export async function updateSosLocation(
  sessionId: string,
  body: { lat: number; lng: number; address?: string },
) {
  const response = await authenticatedRequest(
    `${SOS_BASE}/${sessionId}/location`,
    { method: "PATCH", body },
  );
  return response as ApiResponse<null>;
}

export async function resolveSosSession(sessionId: string) {
  const response = await authenticatedRequest(
    `${SOS_BASE}/${sessionId}/resolve`,
    { method: "PATCH" },
  );
  return response as ApiResponse<ResolveSosSessionResult>;
}

export async function rotateSosShareToken(sessionId: string) {
  const response = await authenticatedRequest(
    `${SOS_BASE}/${encodeURIComponent(sessionId)}/share-token`,
    { method: "POST" },
  );
  return response as ApiResponse<RotateSosShareTokenResult>;
}

// Owner-only full lifecycle snapshot — used for the victim's initial load
// and as the polling fallback when the SSE stream drops (see useSosLifecycle).
export async function getSosSession(sessionId: string) {
  const response = await authenticatedRequest(
    `${SOS_BASE}/${encodeURIComponent(sessionId)}`,
    { method: "GET" },
  );
  return response as ApiResponse<SosSnapshot>;
}

// No auth — public tracking page. Callers distinguish 404/410 via
// `err instanceof ApiError && err.code` (see src/lib/fetch.ts).
export async function getPublicSosSession(sessionId: string) {
  const response = await fetchRequest(
    `${SOS_BASE}/${encodeURIComponent(sessionId)}/public`,
    { method: "GET" },
  );
  return response as ApiResponse<SosPublicSession>;
}
