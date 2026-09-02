import { describe, expect, it } from "vitest";
import { toNavProgressUpdate } from "../navProgress";
import type { VoiceNavigationEvent } from "../voiceSession";

type NavProgressEvent = Extract<VoiceNavigationEvent, { type: "nav.progress" }>;

/** The server may omit optional progress fields entirely (or send an
 * unparsable value); these tests feed exactly those payloads to the parser. */
type PartialProgressEvent = Pick<NavProgressEvent, "type"> &
  Partial<Record<keyof NavProgressEvent, unknown>> &
  NavProgressEvent;

describe("toNavProgressUpdate", () => {
  it("maps a complete progress event with real backend etaSource values", () => {
    const event: NavProgressEvent = {
      type: "nav.progress",
      navigationId: "11111111-1111-4111-8111-111111111111",
      routeVersion: 1,
      currentStepIndex: 0,
      remainingDistanceM: 240,
      remainingDurationSec: 180,
      estimatedArrivalAt: "2026-09-02T12:00:00.000Z",
      etaSource: "realtime",
      distanceToNextM: 12,
    };

    expect(toNavProgressUpdate(event)).toEqual({
      remainingM: 240,
      remainingDurationSec: 180,
      estimatedArrivalAt: Date.parse("2026-09-02T12:00:00.000Z"),
      etaSource: "realtime",
      distanceToNextM: 12,
    });
  });

  it("omits keys that are absent from the event", () => {
    const update = toNavProgressUpdate({
      type: "nav.progress",
    } as PartialProgressEvent);

    expect(Object.keys(update)).toEqual([]);
    expect(update).not.toHaveProperty("remainingM");
    expect(update).not.toHaveProperty("estimatedArrivalAt");
  });

  it("omits invalid numeric and ISO values", () => {
    const update = toNavProgressUpdate({
      type: "nav.progress",
      remainingDistanceM: Number.NaN,
      remainingDurationSec: Number.POSITIVE_INFINITY,
      estimatedArrivalAt: "not-an-iso-date",
      distanceToNextM: "not-a-number",
    } as unknown as NavProgressEvent);

    expect(update).not.toHaveProperty("remainingM");
    expect(update).not.toHaveProperty("remainingDurationSec");
    expect(update).not.toHaveProperty("estimatedArrivalAt");
    expect(update).not.toHaveProperty("distanceToNextM");
  });

  it("does not infer an ETA source from an invalid remaining duration", () => {
    const update = toNavProgressUpdate({
      type: "nav.progress",
      remainingDurationSec: Number.NaN,
    } as PartialProgressEvent);

    expect(update).not.toHaveProperty("remainingDurationSec");
    expect(update).not.toHaveProperty("etaSource");
  });

  it("does not infer an ETA source from an invalid arrival timestamp", () => {
    const update = toNavProgressUpdate({
      type: "nav.progress",
      estimatedArrivalAt: "not-an-iso-date",
    } as PartialProgressEvent);

    expect(update).not.toHaveProperty("estimatedArrivalAt");
    expect(update).not.toHaveProperty("etaSource");
  });

  it("clamps negative distances to zero", () => {
    expect(
      toNavProgressUpdate({
        type: "nav.progress",
        remainingDistanceM: -240,
        remainingDurationSec: -180,
        distanceToNextM: -12,
      } as PartialProgressEvent),
    ).toEqual({
      remainingM: 0,
      remainingDurationSec: 0,
      etaSource: "estimated",
      distanceToNextM: 0,
    });
  });

  it("defaults the source to estimated when an ETA field is present without etaSource", () => {
    expect(
      toNavProgressUpdate({
        type: "nav.progress",
        remainingDurationSec: 180,
      } as PartialProgressEvent),
    ).toEqual({ remainingDurationSec: 180, etaSource: "estimated" });
  });
});
