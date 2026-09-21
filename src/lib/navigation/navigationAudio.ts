/**
 * Who owns spoken navigation output at any moment.
 *
 * Two independent speakers exist: the local Web Speech TTS driven by
 * `navStore.voiceEnabled`, and the Gemini Voice audio channel driven by
 * `voiceStore.isMuted`. The speaker button in the HUD and in the map
 * controls must drive whichever one is actually audible, so both surfaces
 * resolve ownership through these predicates instead of re-deriving it.
 */

import {
  isVoiceSpeechChannelLive,
  type VoiceStatusName,
} from "@/lib/voice/voiceSession";
import type { NavigationSource } from "@/stores/useNavStore";

/**
 * Gemini owns spoken navigation output only when it owns the navigation
 * itself *and* its audio channel can carry speech. A background voice
 * session during a purely local navigation must not mute the local TTS or
 * steal the speaker button.
 */
export function geminiOwnsNavigationSpeech(
  navigationSource: NavigationSource,
  voiceStatus: VoiceStatusName,
): boolean {
  return navigationSource === "voice" && isVoiceSpeechChannelLive(voiceStatus);
}

export interface NavigationAudioState {
  /** Result of `geminiOwnsNavigationSpeech`. */
  geminiOwnsSpeech: boolean;
  /** `voiceStore.isMuted` — only meaningful while Gemini owns the channel. */
  geminiMuted: boolean;
  /** `navStore.voiceEnabled` — only meaningful while it does not. */
  localVoiceEnabled: boolean;
}

/** What the speaker button renders as pressed / un-pressed. */
export function isNavigationAudioActive(state: NavigationAudioState): boolean {
  return state.geminiOwnsSpeech ? !state.geminiMuted : state.localVoiceEnabled;
}

/** Which speaker the button drives, and the state it flips to. */
export interface NavigationAudioToggle {
  target: "gemini" | "local";
  nextActive: boolean;
}

export function resolveNavigationAudioToggle(
  state: NavigationAudioState,
): NavigationAudioToggle {
  // Toggling flips `muted`, so the next audible state is the current flag.
  return state.geminiOwnsSpeech
    ? { target: "gemini", nextActive: state.geminiMuted }
    : { target: "local", nextActive: !state.localVoiceEnabled };
}

/**
 * Whether the local speech synthesiser may speak. It never doubles up on a
 * live Gemini channel, and it still obeys the local toggle otherwise.
 */
export function shouldSpeakLocally(
  state: Omit<NavigationAudioState, "geminiMuted">,
): boolean {
  return !state.geminiOwnsSpeech && state.localVoiceEnabled;
}
