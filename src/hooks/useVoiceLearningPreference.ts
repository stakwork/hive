"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

// Module-level cache so all surfaces on the same page share one fetch
let cache: { enabled: boolean } | null = null;
let inflightPromise: Promise<{ enabled: boolean }> | null = null;

/** Clears the module-level cache (call after the user toggles their preference). */
export function resetVoiceLearningCache() {
  cache = null;
  inflightPromise = null;
}

export function useVoiceLearningPreference() {
  const [state, setState] = useState<{ enabled: boolean; loading: boolean }>(
    cache ? { ...cache, loading: false } : { enabled: false, loading: true }
  );

  useEffect(() => {
    if (cache) {
      setState({ ...cache, loading: false });
      return;
    }
    if (!inflightPromise) {
      inflightPromise = fetch("/api/user/preferences")
        .then((r) => r.json())
        .then((d) => {
          cache = { enabled: !!d.voiceLearningEnabled };
          return cache;
        })
        .catch(() => {
          cache = { enabled: false };
          return cache;
        });
    }
    inflightPromise.then((c) => setState({ ...c, loading: false }));
  }, []);

  const nudgeIfNeeded = useCallback(() => {
    if (state.loading || state.enabled) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem("voice_learning_nudge_seen")) return;
    localStorage.setItem("voice_learning_nudge_seen", "1");
    toast("Improve voice transcription", {
      description:
        "Enable voice correction learning in your profile to help improve dictation accuracy.",
      action: {
        label: "Go to profile",
        onClick: () => {
          window.location.href = "/profile";
        },
      },
      duration: 8000,
    });
  }, [state]);

  return { ...state, nudgeIfNeeded };
}
