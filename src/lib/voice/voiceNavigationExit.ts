/**
 * What the voice session must do when a navigation ends, whoever ended it.
 *
 * Extracted from `VoiceSessionHost`'s map-store subscription so the rule is
 * testable without a DOM: the host only supplies the stores' current values
 * and their setters.
 */

import type { NavigationSource } from "@/stores/useNavStore";

export interface NavigationExitInput {
  navigationSource: NavigationSource;
  /** True when the backend ended it (`nav.stop`), so no cancel is echoed. */
  serverStopped: boolean;
}

export interface NavigationExitActions {
  cancelNavigation(): void;
  setNavigationSource(source: NavigationSource): void;
  setMuted(muted: boolean): void;
}

export function handleNavigationExit(
  input: NavigationExitInput,
  actions: NavigationExitActions,
): void {
  // Any UI path that leaves a backend-owned navigation emits nav.cancel;
  // a server-originated stop already changed the source, so it is not echoed.
  if (input.navigationSource === "voice" && !input.serverStopped) {
    actions.cancelNavigation();
  }
  actions.setNavigationSource("local");
  // The speaker button is the only way to reach the Gemini mute, and it goes
  // back to driving the local TTS the moment navigation ends — leaving the
  // session muted (and deaf, since the uplink is dropped too) with no control
  // able to undo it.
  actions.setMuted(false);
}
