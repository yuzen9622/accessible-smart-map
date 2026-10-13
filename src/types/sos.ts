export type SosType = "body" | "trapped" | "share_location";
export type BindStatus = "pending" | "bound";
export type SosStatus = "active" | "resolved";

export interface EmergencyContact {
  _id: string;
  name: string;
  bindStatus: BindStatus;
  lineUserId: string | null;
  bindCodeExpiresAt: string | null;
  createdAt: string;
}

export interface CreateEmergencyContactResult {
  contact: EmergencyContact;
  bindUrl: string;
  bindCode: string;
}

export interface CreateSosSessionInput {
  type: SosType;
  lat: number;
  lng: number;
  address?: string;
}

export interface CreateSosSessionResult {
  sessionId: string;
  shareToken: string;
  notifiedCount: number;
}

export interface ResolveSosSessionResult {
  sessionId: string;
  status: "resolved";
}

export interface RotateSosShareTokenResult {
  sessionId: string;
  shareToken: string;
}

export interface SosPublicSession {
  type: SosType;
  status: SosStatus;
  /** Resolved public responses intentionally omit all location fields. */
  lat?: number;
  lng?: number;
  address?: string | null;
  updatedAt?: string;
  resolvedAt?: string | null;
  /** Family handling progress; never carries contact names. Older servers omit it. */
  handlingStatus?: HandlingStatus | "pending";
}

/** Fine-grained progress of a family member handling the SOS (owner-only). */
export type HandlingStatus =
  | "notified"
  | "acknowledged"
  | "claimed"
  | "en_route"
  | "arrived"
  | "resolved";

export type SosActorType = "victim" | "system" | "contact";

export type SosTimelineType =
  | "created"
  | "notified"
  | "acknowledged"
  | "claimed"
  | "status_update"
  | "resolved";

export interface SosAcknowledgement {
  lineUserId: string;
  name: string;
  at: string;
}

export interface SosTimelineEntry {
  type: SosTimelineType;
  actorType: SosActorType;
  actorName: string | null;
  note: string | null;
  at: string;
}

/**
 * Full owner-only snapshot from `GET /sessions/:id` and each SSE `update`
 * event. `status` is the master switch (active/resolved); `handlingStatus`
 * is the family member's fine-grained progress.
 */
export interface SosSnapshot {
  sessionId: string;
  status: SosStatus;
  handlingStatus: HandlingStatus;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  acknowledgements: SosAcknowledgement[];
  timeline: SosTimelineEntry[];
  location: {
    lat: number;
    lng: number;
    address: string | null;
    updatedAt: string;
  } | null;
  /** Anonymous public-link readers; older servers omit viewer fields. */
  viewers?: { firstSeenAt: string; lastSeenAt: string }[];
  activeViewerCount?: number;
  viewerActiveWindowSeconds?: number;
  resolvedAt: string | null;
  updatedAt: string;
}
