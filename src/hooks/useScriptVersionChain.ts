"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScriptChainEntry {
  versionId: number;
  versionNumber: number;
  value: string;
}

export interface ScriptVersionChainResult {
  /** The task's versions, oldest first. Empty when nothing could be resolved. */
  iterations: ScriptChainEntry[];
  /** The version immediately before the earliest iteration. null = the task started from the script's first version. */
  baseline: ScriptChainEntry | null;
  isLoading: boolean;
  error: string | null;
}

interface VersionListResponse {
  success: boolean;
  data: { versions?: Array<{ id?: number; version_number?: number }> };
}

interface VersionDetailResponse {
  success: boolean;
  data: { value?: string; source_code?: string; version_number?: number };
}

const EMPTY: ScriptVersionChainResult = {
  iterations: [],
  baseline: null,
  isLoading: false,
  error: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Rebuilds a task's script edit history from Stakwork, for artifacts that carry
 * no captured snapshots (created before ingestion-time capture, or in a
 * workspace where capture is gated off).
 *
 * The baseline is *positional* — the version immediately below the task's
 * earliest change — never the currently-published one, which moves onto the
 * change itself the moment you publish and makes the diff read as identical.
 *
 * Costs one list request plus one body request per version involved. Script
 * bodies are only available per version; the list carries metadata alone.
 *
 * Pass `enabled: false` when snapshots are present — the hook then does no work.
 */
export function useScriptVersionChain(
  scriptId: number,
  versionIds: number[],
  enabled: boolean,
): ScriptVersionChainResult {
  const [state, setState] = useState<ScriptVersionChainResult>(
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
  const key = `${scriptId}:${[...versionIds].sort((a, b) => a - b).join(",")}:${enabled}`;

  useEffect(() => {
    if (!enabled || scriptId == null || versionIds.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    setState({ ...EMPTY, isLoading: true });

    const fetchVersion = async (versionId: number): Promise<ScriptChainEntry | null> => {
      const res = await fetch(`/api/workflow/scripts/${scriptId}/versions/${versionId}`);
      if (!res.ok) {
        console.error(`Script version ${versionId} fetch failed: ${res.status}`);
        return null;
      }
      const json: VersionDetailResponse = await res.json();
      const value = json.data?.value ?? json.data?.source_code;
      if (typeof value !== "string") return null;
      return {
        versionId,
        versionNumber: json.data?.version_number ?? 0,
        value,
      };
    };

    const run = async () => {
      try {
        // The list gives version numbers (and therefore ordering); bodies come
        // one request at a time.
        const listRes = await fetch(`/api/workflow/scripts/${scriptId}/versions`);
        if (!listRes.ok) throw new Error(`Script versions fetch failed: ${listRes.status}`);

        const listJson: VersionListResponse = await listRes.json();
        const all = (listJson.data?.versions ?? []).filter(
          (v): v is { id: number; version_number: number } =>
            typeof v?.id === "number" && typeof v?.version_number === "number",
        );

        const numberById = new Map(all.map((v) => [v.id, v.version_number]));

        const ordered = [...new Set(versionIds)].sort(
          (a, b) => (numberById.get(a) ?? 0) - (numberById.get(b) ?? 0),
        );

        // The version the task started from: the highest one below its first change.
        const earliestNumber = numberById.get(ordered[0]);
        const baselineMeta =
          earliestNumber !== undefined
            ? all
                .filter((v) => v.version_number < earliestNumber)
                .sort((a, b) => b.version_number - a.version_number)[0]
            : undefined;

        const [iterationEntries, baselineEntry] = await Promise.all([
          Promise.all(ordered.map(fetchVersion)),
          baselineMeta ? fetchVersion(baselineMeta.id) : Promise.resolve(null),
        ]);

        const iterations = iterationEntries
          .filter((e): e is ScriptChainEntry => e !== null)
          .map((e) => ({
            ...e,
            // Trust the list's numbering — the detail payload may omit it.
            versionNumber: numberById.get(e.versionId) ?? e.versionNumber,
          }))
          .sort((a, b) => a.versionNumber - b.versionNumber);

        if (!cancelled && mountedRef.current) {
          setState({
            iterations,
            baseline: baselineEntry
              ? {
                  ...baselineEntry,
                  versionNumber: baselineMeta?.version_number ?? baselineEntry.versionNumber,
                }
              : null,
            isLoading: false,
            error: null,
          });
        }
      } catch (e) {
        console.error("useScriptVersionChain: fetch error:", e);
        if (!cancelled && mountedRef.current) {
          setState({
            ...EMPTY,
            error: e instanceof Error ? e.message : "Unknown error loading script versions.",
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
