"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromptChainEntry {
  versionId: string;
  versionNumber: number;
  value: string;
}

export interface PromptVersionChainResult {
  /** The task's versions, oldest first. Empty when nothing could be resolved. */
  iterations: PromptChainEntry[];
  /** The version immediately before the earliest iteration. null = the task started from the prompt's first version. */
  baseline: PromptChainEntry | null;
  isLoading: boolean;
  error: string | null;
}

interface PromptVersionEntry {
  id: string;
  value: string;
  version_number?: number;
}

interface PromptVersionsResponse {
  success: boolean;
  data: { versions: PromptVersionEntry[] };
}

const EMPTY: PromptVersionChainResult = {
  iterations: [],
  baseline: null,
  isLoading: false,
  error: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Rebuilds a task's prompt edit history from the live versions list, for
 * artifacts that carry no captured snapshots (created before ingestion-time
 * capture, or in a workspace where capture is gated off).
 *
 * The baseline is *positional* — the version immediately below the task's
 * earliest change — never the currently-published one. Publishing moves the
 * published pointer, so using it here makes an already-published change read as
 * "no changes detected"; the version before the task started never moves.
 *
 * Values are read from the versions list, which is immutable per version, so
 * the reconstructed diff is as stable as a captured snapshot. It is only less
 * precise in one way: it cannot know what was published back when the change
 * was made, which is exactly what the captured baseline is for.
 *
 * Pass `enabled: false` when snapshots are present — the hook then does no work.
 */
export function usePromptVersionChain(
  promptId: string,
  versionIds: string[],
  enabled: boolean,
): PromptVersionChainResult {
  const [state, setState] = useState<PromptVersionChainResult>(
    enabled ? { ...EMPTY, isLoading: true } : EMPTY,
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Order-independent key: the same set of versions must not refetch just
  // because the artifacts arrived in a different order.
  const key = `${promptId}:${[...versionIds].sort().join(",")}:${enabled}`;

  useEffect(() => {
    if (!enabled || !promptId || versionIds.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    setState({ ...EMPTY, isLoading: true });

    const run = async () => {
      try {
        const res = await fetch(`/api/workflow/prompts/${promptId}/versions`);
        if (!res.ok) throw new Error(`Prompt versions fetch failed: ${res.status}`);

        const json: PromptVersionsResponse = await res.json();
        if (!json.success) throw new Error("Prompt versions response unsuccessful");

        const all: PromptChainEntry[] = (json.data?.versions ?? [])
          .filter((v) => typeof v.version_number === "number" && typeof v.value === "string")
          .map((v) => ({
            versionId: v.id,
            versionNumber: v.version_number as number,
            value: v.value,
          }));

        const wanted = new Set(versionIds);
        const iterations = all
          .filter((v) => wanted.has(v.versionId))
          .sort((a, b) => a.versionNumber - b.versionNumber);

        // The version the task started from: the highest one below its first change.
        const earliest = iterations[0];
        const baseline = earliest
          ? all
              .filter((v) => v.versionNumber < earliest.versionNumber)
              .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
          : null;

        if (!cancelled && mountedRef.current) {
          setState({ iterations, baseline, isLoading: false, error: null });
        }
      } catch (e) {
        console.error("usePromptVersionChain: fetch error:", e);
        if (!cancelled && mountedRef.current) {
          setState({
            ...EMPTY,
            error: e instanceof Error ? e.message : "Unknown error loading prompt versions.",
          });
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
