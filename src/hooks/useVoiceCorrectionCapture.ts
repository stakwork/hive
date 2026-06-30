"use client";

import { useCallback } from "react";
import { useVoiceLearningPreference } from "./useVoiceLearningPreference";

const VALID_SURFACES = [
  "task_chat",
  "plan_chat",
  "plan_start",
  "task_start",
  "whiteboard",
  "sidebar",
] as const;

type VoiceSurface = (typeof VALID_SURFACES)[number];

interface CaptureParams {
  rawTranscript: string;
  preVoiceText: string;
  finalText: string;
}

export function useVoiceCorrectionCapture({
  surface,
  workspaceId,
  orgGithubLogin,
}: {
  surface: VoiceSurface;
  workspaceId?: string;
  orgGithubLogin?: string;
}) {
  const { enabled } = useVoiceLearningPreference();

  const capture = useCallback(
    ({ rawTranscript, preVoiceText, finalText }: CaptureParams) => {
      if (!enabled || !rawTranscript.trim()) return;
      const expected = preVoiceText
        ? `${preVoiceText} ${rawTranscript}`.trim()
        : rawTranscript.trim();
      if (expected === finalText) return; // No correction — user accepted transcript as-is
      fetch("/api/voice-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawTranscript,
          preVoiceText,
          finalText,
          surface,
          workspaceId: workspaceId || undefined, // strip empty strings client-side
          orgGithubLogin,
        }),
      }).catch(() => {}); // fire-and-forget, never throws
    },
    [enabled, surface, workspaceId, orgGithubLogin]
  );

  return { capture };
}
