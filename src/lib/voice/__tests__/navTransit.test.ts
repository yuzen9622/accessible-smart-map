import { beforeEach, describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zh from "@/i18n/locale/zh-TW/translation.json";
import useNavStore from "@/stores/useNavStore";
import type {
  AccessibleRoute,
  BusLeg,
  MetroLeg,
  NavInstruction,
} from "@/types/route";
import { resumedTransit, voiceTransitNames } from "../navTransit";
import type { VoiceNavStep } from "../voiceSession";

const bus = (name: string, from: string, to: string) =>
  ({
    type: "BUS",
    routeName: name,
    departureStop: from,
    arrivalStop: to,
  }) as BusLeg;
const route = {
  legs: [bus("藍7", "市府", "松山"), bus("307", "松山", "公館")],
} as AccessibleRoute;
const steps = [
  { type: "transit_board", legType: "BUS", isTransit: true },
  { type: "transit_alight", legType: "BUS", isTransit: true },
  { type: "transit_board", legType: "BUS", isTransit: true },
] as VoiceNavStep[];

beforeEach(() => useNavStore.getState().reset());
describe("backend-owned transit snapshot", () => {
  it("restores the correct repeated-mode leg rather than the first bus", () => {
    expect(resumedTransit(route, steps, 2, true)).toEqual({
      onVehicle: true,
      leg: { mode: "BUS", from: "松山", to: "公館", routeName: "307" },
    });
  });
  it("restores the metro train terminal separately from the alighting station", () => {
    const metro = {
      type: "METRO",
      lineName: "板南線",
      departureStation: "市政府",
      arrivalStation: "台北車站",
      terminalStation: "頂埔",
    } as MetroLeg;
    const metroSteps = [
      { type: "transit_board", legType: "METRO", isTransit: true },
    ] as VoiceNavStep[];
    expect(
      resumedTransit({ legs: [metro] } as AccessibleRoute, metroSteps, 0, true),
    ).toEqual({
      onVehicle: true,
      leg: {
        mode: "METRO",
        from: "市政府",
        to: "台北車站",
        routeName: "板南線",
        terminalStation: "頂埔",
      },
    });
    const { terminalStation: _omit, ...noTerminal } = metro;
    expect(
      resumedTransit(
        { legs: [noTerminal] } as AccessibleRoute,
        metroSteps,
        0,
        true,
      )?.leg,
    ).not.toHaveProperty("terminalStation");
  });
  it.each([
    [
      "en",
      en,
      "Bannan Line · toward Dingpu",
      "Taipei City Hall",
      "Taipei Main Station",
    ],
    ["zh-TW", zh, "板南線・往頂埔", "市政府", "台北車站"],
  ] as const)(
    "renders the voice HUD leg in the current %s UI language",
    (language, messages, route, from, to) => {
      const t = (key: string, values?: Record<string, unknown>) => {
        const found = key
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              (node as Record<string, unknown> | undefined)?.[part],
            messages,
          );
        return (
          typeof found === "string"
            ? found
            : String(values?.defaultValue ?? key)
        ).replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name]));
      };
      const leg = {
        mode: "METRO" as const,
        from: "市政府",
        to: "台北車站",
        routeName: "板南線",
        lineKey: "TRTC_BL",
        fromNameEn: "Taipei City Hall",
        toNameEn: "Taipei Main Station",
        terminalStation: "頂埔",
        terminalNameEn: "Dingpu",
      };
      expect(voiceTransitNames(leg, language, t)).toEqual({ route, from, to });
      expect(
        voiceTransitNames(
          {
            mode: "METRO",
            from: "市政府",
            to: "台北車站",
            routeName: "板南線",
          },
          language,
          t,
        ),
      ).toEqual({ route: "板南線", from: "市政府", to: "台北車站" });
    },
  );
  it("restores labels and English names so a resumed HUD follows the UI language", () => {
    const metro = {
      type: "METRO",
      lineKey: "TRTC_BL",
      lineName: "板南線",
      departureStation: "市政府",
      fromNameEn: "Taipei City Hall",
      arrivalStation: "台北車站",
      toNameEn: "Taipei Main Station",
      terminalStation: "頂埔",
      terminalNameEn: "Dingpu",
      routeDisplayName: "板南線",
      displayLanguage: "zh-TW",
    } as MetroLeg;
    expect(
      resumedTransit(
        { legs: [metro] } as AccessibleRoute,
        [
          { type: "transit_board", legType: "METRO", isTransit: true },
        ] as VoiceNavStep[],
        0,
        true,
      )?.leg,
    ).toEqual({
      mode: "METRO",
      from: "市政府",
      to: "台北車站",
      routeName: "板南線",
      terminalStation: "頂埔",
      lineKey: "TRTC_BL",
      fromNameEn: "Taipei City Hall",
      toNameEn: "Taipei Main Station",
      terminalNameEn: "Dingpu",
    });
  });
  it("does not invent a route when legacy steps are ambiguous", () => {
    expect(
      resumedTransit(route, [{ legType: "BUS" }] as VoiceNavStep[], 0, true),
    ).toEqual({ onVehicle: true, leg: null });
  });
  it("adopts the backend's not-on-vehicle state", () => {
    expect(resumedTransit(route, steps, 0, false)).toBeNull();
  });
  it.each(["arrived", "local", "instructions", "walking", "alighting"])(
    "clears stale transit on %s",
    (transition) => {
      const nav = useNavStore.getState();
      nav.setNavigationSource("voice");
      nav.setInstructions([
        { type: "turn", legType: "WALK" },
        { type: "transit_alight", legType: "BUS" },
      ] as NavInstruction[]);
      useNavStore.setState({
        voiceTransit: {
          onVehicle: true,
          leg: { mode: "BUS", from: "市府", to: "松山" },
        },
      });
      if (transition === "arrived") nav.setArrived(true);
      else if (transition === "local") nav.setNavigationSource("local");
      else if (transition === "instructions") nav.setInstructions([]);
      else nav.applyVoiceStep(transition === "walking" ? 0 : 1, "下一步", 10);
      expect(useNavStore.getState().voiceTransit).toBeNull();
    },
  );
});
