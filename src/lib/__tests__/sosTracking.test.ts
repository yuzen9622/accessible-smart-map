import { describe, expect, it } from "vitest";
import type { SosSnapshot } from "@/types/sos";
import {
  buildSosTrackingUrl,
  countActiveSosViewers,
  isTrackableSosSession,
  readSosTrackingToken,
} from "../sosTracking";

function location(hash: string, search: string) {
  return { hash, search } as Pick<Location, "hash" | "search">;
}

const snapshot: SosSnapshot = {
  sessionId: "session-1",
  status: "active",
  handlingStatus: "notified",
  claimedBy: null,
  claimedByName: null,
  claimedAt: null,
  acknowledgements: [],
  timeline: [],
  location: {
    lat: 25.033,
    lng: 121.5654,
    address: null,
    updatedAt: "2026-10-13T02:00:00.000Z",
  },
  viewers: [
    {
      firstSeenAt: "2026-10-13T01:55:00.000Z",
      lastSeenAt: "2026-10-13T01:59:30.000Z",
    },
    {
      firstSeenAt: "2026-10-13T01:40:00.000Z",
      lastSeenAt: "2026-10-13T01:50:00.000Z",
    },
  ],
  viewerActiveWindowSeconds: 180,
  resolvedAt: null,
  updatedAt: "2026-10-13T02:00:00.000Z",
};

describe("SOS tracking URL privacy", () => {
  it("reads fragment tokens first and supports legacy query keys", () => {
    expect(
      readSosTrackingToken(location("#token=new-token", "?token=old-token")),
    ).toBe("new-token");
    expect(readSosTrackingToken(location("", "?token=old-token"))).toBe(
      "old-token",
    );
    expect(
      readSosTrackingToken(location("", "?sos=older-token"), ["sos"]),
    ).toBe("older-token");
  });

  it("builds links with the token only in the fragment", () => {
    const url = buildSosTrackingUrl(
      "https://map.example.com/",
      "zh-TW",
      "secret/token",
    );
    expect(url).toBe("https://map.example.com/zh-TW/sos/#token=secret%2Ftoken");
    expect(new URL(url).search).toBe("");
  });
});

describe("SOS tracking response safety", () => {
  it("rejects resolved or incomplete sessions as map locations", () => {
    expect(
      isTrackableSosSession({
        type: "body",
        status: "resolved",
        resolvedAt: "2026-10-13T02:00:00.000Z",
      }),
    ).toBe(false);
    expect(isTrackableSosSession({ type: "body", status: "active" })).toBe(
      false,
    );
    expect(
      isTrackableSosSession({
        type: "body",
        status: "active",
        lat: 25.033,
        lng: 121.5654,
        updatedAt: "2026-10-13T02:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("computes active viewers from lastSeenAt and the supplied window", () => {
    const now = Date.parse("2026-10-13T02:00:00.000Z");
    expect(countActiveSosViewers(snapshot, now)).toBe(1);
    expect(
      countActiveSosViewers({ ...snapshot, viewers: undefined }, now),
    ).toBe(0);
  });
});
