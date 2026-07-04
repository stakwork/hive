"use client";

import { useState, useEffect, useRef } from "react";

export type ItemBaselineInput =
  | { type: "PROMPT"; promptId: string; promptVersionId: string }
  | { type: "SCRIPT"; scriptId: number; scriptVersionId: number };

export interface ItemBaselineResult {
  baseline: string | null;
  updated: string | null;
  isLoading: boolean;
  error: string | null;
}

interface PromptVersionsResponse {
  success: boolean;
  data: {
    versions: Array<{ id: string; value: string; published: boolean }>;
    published_version_id: string | null;
  };
}

interface ScriptVersionsResponse {
  success: boolean;
  data: {
    versions: Array<{ id: number; published_version_id?: number }>;
    published_version_id?: number;
  };
}

interface ScriptVersionResponse {
  success: boolean;
  data: { value: string };
}

async function fetchPromptBaseline(
  promptId: string,
  promptVersionId: string,
): Promise<{ baseline: string | null; updated: string | null; error: string | null }> {
  const res = await fetch(`/api/workflow/prompts/${promptId}/versions`);
  if (!res.ok) {
    throw new Error(`Prompt versions fetch failed: ${res.status}`);
  }
  const json: PromptVersionsResponse = await res.json();
  if (!json.success) {
    throw new Error("Prompt versions response indicated failure");
  }

  const { versions, published_version_id } = json.data;

  const baselineVersion = published_version_id
    ? versions.find((v) => v.id === published_version_id)
    : null;

  const updatedVersion = versions.find((v) => v.id === promptVersionId);

  return {
    baseline: baselineVersion?.value ?? null,
    updated: updatedVersion?.value ?? null,
    error: updatedVersion ? null : "Updated prompt version not found",
  };
}

async function fetchScriptBaseline(
  scriptId: number,
  scriptVersionId: number,
): Promise<{ baseline: string | null; updated: string | null; error: string | null }> {
  // Step 1: get versions list to find published_version_id
  const versionsRes = await fetch(`/api/workflow/scripts/${scriptId}/versions`);
  if (!versionsRes.ok) {
    throw new Error(`Script versions fetch failed: ${versionsRes.status}`);
  }
  const versionsJson: ScriptVersionsResponse = await versionsRes.json();
  if (!versionsJson.success) {
    throw new Error("Script versions response indicated failure");
  }

  const publishedVersionId = versionsJson.data?.published_version_id ?? null;

  // Step 2: fetch both version bodies in parallel
  const fetchVersion = async (versionId: number): Promise<string | null> => {
    const res = await fetch(`/api/workflow/scripts/${scriptId}/versions/${versionId}`);
    if (!res.ok) return null;
    const json: ScriptVersionResponse = await res.json();
    if (!json.success) return null;
    return json.data?.value ?? null;
  };

  const fetches: [Promise<string | null>, Promise<string | null>] = [
    publishedVersionId != null ? fetchVersion(publishedVersionId) : Promise.resolve(null),
    fetchVersion(scriptVersionId),
  ];

  const [baseline, updated] = await Promise.all(fetches);

  return {
    baseline,
    updated,
    error: updated === null ? "Updated script version not found or failed to fetch" : null,
  };
}

function getInputKey(input: ItemBaselineInput): string {
  if (input.type === "PROMPT") {
    return `PROMPT:${input.promptId}:${input.promptVersionId}`;
  }
  return `SCRIPT:${input.scriptId}:${input.scriptVersionId}`;
}

export function useItemBaseline(input: ItemBaselineInput): ItemBaselineResult {
  const [result, setResult] = useState<ItemBaselineResult>({
    baseline: null,
    updated: null,
    isLoading: true,
    error: null,
  });

  // Track the current input key so we skip stale updates
  const currentKeyRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const key = getInputKey(input);
    currentKeyRef.current = key;

    setResult({ baseline: null, updated: null, isLoading: true, error: null });

    const run = async () => {
      try {
        let resolved: { baseline: string | null; updated: string | null; error: string | null };

        if (input.type === "PROMPT") {
          resolved = await fetchPromptBaseline(input.promptId, input.promptVersionId);
        } else {
          resolved = await fetchScriptBaseline(input.scriptId, input.scriptVersionId);
        }

        if (!mountedRef.current || currentKeyRef.current !== key) return;

        setResult({
          baseline: resolved.baseline,
          updated: resolved.updated,
          isLoading: false,
          error: resolved.error,
        });
      } catch (err) {
        console.error("[useItemBaseline] Failed to resolve baseline:", err);
        if (!mountedRef.current || currentKeyRef.current !== key) return;
        setResult({ baseline: null, updated: null, isLoading: false, error: String(err) });
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getInputKey(input)]);

  return result;
}
