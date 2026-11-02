import { describe, expect, it } from "vitest";
import { aiVenueJourney } from "../aiVenueLeg";
import { isIndoorOnlyJourney, venueJourneySteps } from "../journey";
import {
  aiVenueDetail,
  arrivalLeg,
  departureLeg,
  handover,
} from "./fixtures/aiVenue";

describe("AI venue legs through the official route boundary", () => {
  it("presents an arrival leg from the gate to the indoor place", () => {
    const leg = arrivalLeg();
    const { journey, models } = aiVenueJourney(
      aiVenueDetail(),
      {
        direction: "arrival",
        handover: handover(leg, "room-2301"),
        route: leg,
      },
      "https://api.example/",
    );
    expect(journey.from).toMatchObject({
      placeId: "gate",
      buildingId: null,
      sourceVersion: "synthetic-campus:4",
    });
    expect(journey.to).toMatchObject({
      placeId: "room-2301",
      buildingId: "east",
      levelRef: "3F",
    });
    expect(journey.buildingId).toBe("east");
    expect(journey.mode).toBe("wheelchair");
    expect(journey.verticalPreference).toBe("elevator");
    expect(journey.backendRoute).toMatchObject({
      provider: "api",
      baseUrl: "https://api.example",
      venueVersion: 4,
    });
    expect(journey.departure).toBeUndefined();
    expect(isIndoorOnlyJourney(journey)).toBe(true);
    expect(venueJourneySteps(journey).map((step) => step.kind)).toContain(
      "elevator",
    );
    expect(journey.route.points).toHaveLength(4);
    expect(models.map((model) => model.building.id)).toEqual(["east"]);
    expect(models[0].preview?.gatePlaceIds).toEqual(["gate"]);
  });

  it("marks a departure leg so it is shown before the outdoor routes", () => {
    const leg = departureLeg();
    const { journey } = aiVenueJourney(
      aiVenueDetail(),
      {
        direction: "departure",
        handover: handover(leg, "room-2301"),
        route: leg,
      },
      "https://api.example",
    );
    expect(journey.from.placeId).toBe("room-2301");
    expect(journey.to.placeId).toBe("gate");
    expect(journey.departure).toBe(true);
    expect(isIndoorOnlyJourney(journey)).toBe(false);
  });

  it("rejects a leg planned against another venue version", () => {
    const leg = arrivalLeg(3);
    expect(() =>
      aiVenueJourney(
        aiVenueDetail(4),
        { direction: "indoor", route: leg },
        "https://api.example",
      ),
    ).toThrow(expect.objectContaining({ reason: "VENUE_VERSION_CHANGED" }));
  });

  it("rejects a path that does not end at the named place", () => {
    const leg = arrivalLeg();
    leg.path.coordinates[3] = [10.00015, 10, 8];
    expect(() =>
      aiVenueJourney(
        aiVenueDetail(),
        { direction: "indoor", route: leg },
        "https://api.example",
      ),
    ).toThrow();
  });
});
