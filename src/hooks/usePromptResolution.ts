"use client";

import { useState, useEffect } from "react";
import { type MessageSegment } from "@/lib/prompts/detect-prompt-names";
import { verifyPromptName, type VerifiedPrompt } from "@/lib/prompts/prompt-verification-cache";

/**
 * For a list of parsed message segments, resolves any prompt / version segments
 * against the prompts API and returns a map of promptName → VerifiedPrompt.
 *
 * - Fires parallel fetches for all unique prompt names found in the segments.
 * - The module-level cache in `prompt-verification-cache` means a second
 *   message containing the same prompt name costs zero additional network calls.
 * - While fetches are in flight the returned map is empty, so all
 *   prompt/version tokens render as plain text (no loading flash).
 * - `segments` identity is stable per message render; the effect runs once.
 */
export function usePromptResolution(
  segments: MessageSegment[],
): Map<string, VerifiedPrompt> {
  const [resolved, setResolved] = useState<Map<string, VerifiedPrompt>>(
    new Map(),
  );

  useEffect(() => {
    const names = [
      ...new Set(
        segments
          .filter((s) => s.type === "prompt" || s.type === "version")
          .map((s) =>
            s.type === "prompt"
              ? s.name
              : (s as Extract<MessageSegment, { type: "version" }>).promptName,
          ),
      ),
    ];

    if (names.length === 0) return;

    Promise.all(
      names.map((n) => verifyPromptName(n).then((r) => [n, r] as const)),
    ).then((entries) => {
      const map = new Map<string, VerifiedPrompt>();
      for (const [name, result] of entries) {
        if (result) map.set(name, result);
      }
      setResolved(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // segments identity is stable per message; no re-run needed

  return resolved;
}
