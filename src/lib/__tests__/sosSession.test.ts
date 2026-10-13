import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearActiveSos, loadActiveSos, saveActiveSos } from "../sosSession";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  const localStorage = createStorage();
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  vi.spyOn(Date, "now").mockReturnValue(1000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("active SOS persistence", () => {
  it("round-trips the session id and current share token", () => {
    saveActiveSos("session-1", "share-token-1");
    expect(loadActiveSos()).toEqual({
      sessionId: "session-1",
      shareToken: "share-token-1",
      savedAt: 1000,
    });
  });

  it("keeps legacy session-only entries recoverable", () => {
    localStorage.setItem(
      "sos.activeSession",
      JSON.stringify({ sessionId: "legacy-session", savedAt: 1000 }),
    );
    expect(loadActiveSos()).toEqual({
      sessionId: "legacy-session",
      shareToken: null,
      savedAt: 1000,
    });
  });

  it("replaces the stored token after a link reset and can clear it", () => {
    saveActiveSos("session-1", "old-token");
    saveActiveSos("session-1", "new-token");
    expect(loadActiveSos()?.shareToken).toBe("new-token");
    clearActiveSos();
    expect(loadActiveSos()).toBeNull();
  });
});
