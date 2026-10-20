import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | undefined)[],
  loadCatalog: vi.fn(),
  setModels: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | undefined) =>
    mocks.effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({}),
  Source: () => null,
  Layer: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/indoor/venueApi", () => ({
  loadVenueCatalog: mocks.loadCatalog,
}));
vi.mock("@/stores/useIndoorCatalog", () => ({
  default: Object.assign(
    (select: (state: unknown) => unknown) =>
      select({ models: [], activeBuildingKey: null }),
    { getState: () => ({ setModels: mocks.setModels }) },
  ),
}));
vi.mock("../VenueCampusRoads", () => ({ default: () => null }));
vi.mock("../VenueCampusRoute", () => ({ default: () => null }));
vi.mock("../VenueJourneyMapSync", () => ({ default: () => null }));
vi.mock("../VenueJourneyPlayback", () => ({ default: () => null }));

import IndoorMapEntry from "../IndoorMapEntry";

function mountEntry() {
  IndoorMapEntry({ open: false, is3D: false, onOpenChange: vi.fn() });
  return mocks.effects[0]();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.effects.length = 0;
  vi.stubEnv("NEXT_PUBLIC_INDOOR_PREVIEW", "0");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("IndoorMapEntry catalog loading", () => {
  it("does not show a toast when optional indoor places fail to load", async () => {
    mocks.loadCatalog.mockRejectedValue(new Error("Catalog unavailable"));
    mountEntry();
    await vi.waitFor(() => expect(mocks.loadCatalog).toHaveBeenCalledOnce());
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.setModels).not.toHaveBeenCalled();
  });

  it("still stores successfully loaded indoor places", async () => {
    const models: unknown[] = [];
    mocks.loadCatalog.mockResolvedValue(models);
    mountEntry();
    await vi.waitFor(() =>
      expect(mocks.setModels).toHaveBeenCalledWith(models),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("does not report an aborted load", async () => {
    let rejectLoad: (reason: Error) => void = () => {};
    mocks.loadCatalog.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectLoad = reject;
        }),
    );
    const cleanup = mountEntry();
    cleanup?.();
    rejectLoad(new Error("Aborted"));
    await Promise.resolve();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
