"use client";

import { useCallback } from "react";
import {
  geminiOwnsNavigationSpeech,
  isNavigationAudioActive,
  resolveNavigationAudioToggle,
} from "@/lib/navigation/navigationAudio";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";

export interface NavigationAudioControl {
  /** True while Gemini Voice — not the local synthesiser — is the speaker. */
  geminiOwnsSpeech: boolean;
  /** What the speaker button renders as pressed. */
  isAudioActive: boolean;
  /** Flips whichever speaker is live; returns the resulting active state. */
  toggleAudio: () => boolean;
}

/**
 * Single source of truth for the navigation speaker button, shared by the
 * HUD and the map controls so the two surfaces can never disagree about who
 * owns the audio.
 */
export default function useNavigationAudio(): NavigationAudioControl {
  const navigationSource = useNavStore((s) => s.navigationSource);
  const voiceEnabled = useNavStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useNavStore((s) => s.setVoiceEnabled);
  const voiceStatus = useVoiceStore((s) => s.status);
  const geminiMuted = useVoiceStore((s) => s.isMuted);
  const toggleGeminiMute = useVoiceStore((s) => s.toggleMute);

  const geminiOwnsSpeech = geminiOwnsNavigationSpeech(
    navigationSource,
    voiceStatus.status,
  );
  const isAudioActive = isNavigationAudioActive({
    geminiOwnsSpeech,
    geminiMuted,
    localVoiceEnabled: voiceEnabled,
  });

  const toggleAudio = useCallback(() => {
    const { target, nextActive } = resolveNavigationAudioToggle({
      geminiOwnsSpeech,
      geminiMuted,
      localVoiceEnabled: voiceEnabled,
    });
    if (target === "gemini") toggleGeminiMute();
    else setVoiceEnabled(nextActive);
    return nextActive;
  }, [
    geminiOwnsSpeech,
    geminiMuted,
    toggleGeminiMute,
    voiceEnabled,
    setVoiceEnabled,
  ]);

  return { geminiOwnsSpeech, isAudioActive, toggleAudio };
}
