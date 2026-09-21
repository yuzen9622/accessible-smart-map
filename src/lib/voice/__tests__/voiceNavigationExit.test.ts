import { describe, expect, it, vi } from "vitest";
import { handleNavigationExit } from "@/lib/voice/voiceNavigationExit";

function makeActions() {
  return {
    cancelNavigation: vi.fn(),
    setNavigationSource: vi.fn(),
    setMuted: vi.fn(),
  };
}

describe("handleNavigationExit", () => {
  it("cancels a backend-owned navigation the UI walked away from", () => {
    const actions = makeActions();
    handleNavigationExit(
      { navigationSource: "voice", serverStopped: false },
      actions,
    );
    expect(actions.cancelNavigation).toHaveBeenCalledTimes(1);
    expect(actions.setNavigationSource).toHaveBeenCalledWith("local");
  });

  it("does not echo a cancel back at a server-originated nav.stop", () => {
    const actions = makeActions();
    handleNavigationExit(
      { navigationSource: "voice", serverStopped: true },
      actions,
    );
    expect(actions.cancelNavigation).not.toHaveBeenCalled();
  });

  it("cancels nothing for a purely local navigation", () => {
    const actions = makeActions();
    handleNavigationExit(
      { navigationSource: "local", serverStopped: false },
      actions,
    );
    expect(actions.cancelNavigation).not.toHaveBeenCalled();
  });

  it.each([
    ["voice", false],
    ["voice", true],
    ["local", false],
  ] as const)(
    "always releases the mute (%s, serverStopped=%s)",
    (navigationSource, serverStopped) => {
      // Regression: the speaker button is the only way to reach the Gemini
      // mute and it stops driving it the moment navigation ends, so a mute
      // surviving the exit left the assistant silent *and* deaf with no
      // control able to undo it.
      const actions = makeActions();
      handleNavigationExit({ navigationSource, serverStopped }, actions);
      expect(actions.setMuted).toHaveBeenCalledWith(false);
    },
  );
});
