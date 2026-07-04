"use client";

import { useState, useEffect, useRef } from "react";

// ── Input types ───────────────────────────────────────────────────────────────

export type ItemBaselineInput =
  | { type: "PROMPT"; promptId: string; promptVersionId: string }
  | { type: "SCRIPT"; scriptId: number; scriptVersionId: number };

// ── Return type ───────────────────────────────────────────────────────────────

export interface ItemBaselineResult {
  baseline: string | null;
  updated: string | null;
  isLoading: boolean;
  error: string | null;
}

// ── Prompt version response shape ─────────────────────────────────────────────

interface PromptVersionEntry {
  id: string;
  value: string;
  published?: boolean;
  version_number?: number;
}

interface PromptVersionsResponse {
  success: boolean;
  data: {
    versions: PromptVersionEntry[];
    published_version_id: string | null;
    current_version_id: string | null;
  };
}

// ── Script version response shape ─────────────────────────────────────────────

interface ScriptVersionsListResponse {
  success: boolean;
  data: {
    versions: Array<{ id: number; published_version_id?: number | null }>;
    published_version_id?: number | null;
  };
}

interface ScriptVersionDetailResponse {
  success: boolean;
  data: {
    value?: string;
    source_code?: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPromptBaseline(
  promptId: string,
  promptVersionId: string,
): Promise<{ baseline: string | null; updated: string | null }> {
  const res = await fetch(`/api/workflow/prompts/${promptId}/versions`);
  if (!res.ok) {
    throw new Error(`Prompt versions fetch failed: ${res.status}`);
  }

  const json: PromptVersionsResponse = await res.json();
  if (!json.success) {
    throw new Error("Prompt versions response unsuccessful");
  }

  const { versions, published_version_id } = json.data;

  const publishedVersion = published_version_id
    ? versions.find((v) => v.id === published_version_id)
    : null;

  const updatedVersion = versions.find((v) => v.id === promptVersionId);

  return {
    baseline: publishedVersion?.value ?? null,
    updated: updatedVersion?.value ?? null,
  };
}

async function fetchScriptBaseline(
  scriptId: number,
  scriptVersionId: number,
): Promise<{ baseline: string | null; updated: string | null }> {
  // Step 1: fetch the versions list to get published_version_id
  const listRes = await fetch(`/api/workflow/scripts/${scriptId}/versions`);
  if (!listRes.ok) {
    throw new Error(`Script versions list fetch failed: ${listRes.status}`);
  }

  const listJson: ScriptVersionsListResponse = await listRes.json();
  if (!listJson.success) {
    throw new Error("Script versions list response unsuccessful");
  }

  const publishedVersionId = listJson.data?.published_version_id ?? null;

  // Step 2: fetch baseline and updated bodies in parallel
  const fetches: [Promise<string | null>, Promise<string | null>] = [
    publishedVersionId != null
      ? fetch(`/api/workflow/scripts/${scriptId}/versions/${publishedVersionId}`)
          .then(async (r): Promise<string | null> => {
            if (!r.ok) {
              console.error(`Script baseline version fetch failed: ${r.status}`);
              return null;
            }
            const j: ScriptVersionDetailResponse = await r.json();
            return j.data?.value ?? j.data?.source_code ?? null;
          })
          .catch((e) => {
            console.error("Script baseline version fetch error:", e);
            return null;
          })
      : Promise.resolve(null),

    fetch(`/api/workflow/scripts/${scriptId}/versions/${scriptVersionId}`)
      .then(async (r): Promise<string | null> => {
        if (!r.ok) {
          throw new Error(`Script updated version fetch failed: ${r.status}`);
        }
        const j: ScriptVersionDetailResponse = await r.json();
        return j.data?.value ?? j.data?.source_code ?? null;
      }),
  ];

  const [baseline, updated] = await Promise.all(fetches);
  return { baseline, updated };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Resolves the baseline (published) and updated (edited) text bodies for a
 * PROMPT or SCRIPT artifact, ready to feed into `DiffView`.
 *
 * - PROMPT: single `/api/workflow/prompts/{id}/versions` call (both bodies in one response).
 * - SCRIPT: fetch versions list → parallel fetch of published + edited body.
 * - Never throws; resolves `baseline: null` on any fetch/parse failure.
 * - Guards against state-after-unmount.
 */
export function useItemBaseline(input: ItemBaselineInput): ItemBaselineResult {
  const [state, setState] = useState<ItemBaselineResult>({
    baseline: null,
    updated: null,
    isLoading: true,
    error: null,
  });

  // Stable key for memoisation / refetch detection
  const key =
    input.type === "PROMPT"
      ? `PROMPT:${input.promptId}:${input.promptVersionId}`
      : `SCRIPT:${input.scriptId}:${input.scriptVersionId}`;

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setState({ baseline: null, updated: null, isLoading: true, error: null });

    const run = async () => {
      try {
        let result: { baseline: string | null; updated: string | null };

        if (input.type === "PROMPT") {
          result = await fetchPromptBaseline(input.promptId, input.promptVersionId);
        } else {
          result = await fetchScriptBaseline(input.scriptId, input.scriptVersionId);
        }

        if (!cancelled && mountedRef.current) {
          setState({
            baseline: result.baseline,
            updated: result.updated,
            isLoading: false,
            error:
              result.updated === null
                ? "Could not load the updated version content."
                : null,
          });
        }
      } catch (e) {
        console.error("useItemBaseline: fetch error:", e);
        if (!cancelled && mountedRef.current) {
          setState({
            baseline: null,
            updated: null,
            isLoading: false,
            error: e instanceof Error ? e.message : "Unknown error loading baseline.",
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
