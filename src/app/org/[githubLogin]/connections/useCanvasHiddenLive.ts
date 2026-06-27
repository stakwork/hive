"use client";

import { useCallback, useEffect, useState } from "react";
import type { CanvasData } from "system-canvas-react";
import type { HiddenLiveEntry } from "./HiddenLivePill";
import { fetchRoot, fetchSub } from "./useCanvasPersistence";

export async function toggleLiveVisibility(
  githubLogin: string,
  ref: string | undefined,
  id: string,
  action: "hide" | "show",
): Promise<void> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: ref ?? "", id, action }),
  });
  if (!res.ok) {
    console.error(
      `[useCanvasHiddenLive] ${action} failed for ${id} (${res.status})`,
    );
  }
}

export async function fetchHiddenLive(
  githubLogin: string,
  ref: string | undefined,
): Promise<HiddenLiveEntry[]> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide${qs}`);
  if (!res.ok) {
    console.error(
      `[useCanvasHiddenLive] fetchHiddenLive failed (${res.status})`,
    );
    return [];
  }
  const body = await res.json();
  return (body.entries ?? []) as HiddenLiveEntry[];
}

interface UseCanvasHiddenLiveOptions {
  githubLogin: string;
  currentRef: string;
  currentRefRef: React.RefObject<string>;
  setRoot: React.Dispatch<React.SetStateAction<CanvasData | null>>;
  setSubCanvases: React.Dispatch<React.SetStateAction<Record<string, CanvasData>>>;
  applyMutation: (
    canvasRef: string | undefined,
    mutate: (data: CanvasData) => CanvasData,
  ) => void;
  onHiddenChange?: (entries: HiddenLiveEntry[]) => void;
}

interface UseCanvasHiddenLiveReturn {
  hiddenLive: HiddenLiveEntry[] | null;
  rootHiddenLive: HiddenLiveEntry[] | null;
  refreshHiddenLive: () => void;
  refreshRootHiddenLive: () => void;
  handleRestoreLive: (id: string) => Promise<void>;
}

export function useCanvasHiddenLive({
  githubLogin,
  currentRef,
  currentRefRef,
  setRoot,
  setSubCanvases,
  onHiddenChange,
}: UseCanvasHiddenLiveOptions): UseCanvasHiddenLiveReturn {
  const [hiddenLive, setHiddenLive] = useState<HiddenLiveEntry[] | null>(null);
  const [rootHiddenLive, setRootHiddenLive] = useState<HiddenLiveEntry[] | null>(null);

  // Initial root hidden-list fetch.
  useEffect(() => {
    let cancelled = false;
    fetchHiddenLive(githubLogin, undefined).then((entries) => {
      if (cancelled) return;
      setRootHiddenLive(entries);
      setHiddenLive(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  // Refetch hidden list when user drills into a sub-canvas.
  useEffect(() => {
    if (currentRef === "") return;
    let cancelled = false;
    setHiddenLive(null);
    fetchHiddenLive(githubLogin, currentRef).then((entries) => {
      if (!cancelled) setHiddenLive(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [githubLogin, currentRef]);

  const refreshHiddenLive = useCallback(() => {
    const ref = currentRefRef.current;
    fetchHiddenLive(githubLogin, ref === "" ? undefined : ref).then(
      setHiddenLive,
    );
  }, [githubLogin, currentRefRef]);

  const refreshRootHiddenLive = useCallback(() => {
    fetchHiddenLive(githubLogin, undefined).then((entries) => {
      setRootHiddenLive(entries);
      if (currentRefRef.current === "") setHiddenLive(entries);
    });
  }, [githubLogin, currentRefRef]);

  // Notify parent when root hidden-live set changes.
  useEffect(() => {
    if (rootHiddenLive === null) return;
    onHiddenChange?.(rootHiddenLive);
  }, [rootHiddenLive, onHiddenChange]);

  const handleRestoreLive = useCallback(
    async (id: string) => {
      const ref = currentRefRef.current;
      const isRoot = ref === "";
      setHiddenLive((prev) =>
        prev === null ? prev : prev.filter((e) => e.id !== id),
      );
      if (isRoot) {
        setRootHiddenLive((prev) =>
          prev === null ? prev : prev.filter((e) => e.id !== id),
        );
      }
      await toggleLiveVisibility(
        githubLogin,
        isRoot ? undefined : ref,
        id,
        "show",
      );
      try {
        if (isRoot) {
          const data = await fetchRoot(githubLogin);
          setRoot(data);
        } else {
          const data = await fetchSub(githubLogin, ref);
          setSubCanvases((prev) => ({ ...prev, [ref]: data }));
        }
      } catch (err) {
        console.error("[useCanvasHiddenLive] refetch after restore failed", err);
        refreshHiddenLive();
        if (isRoot) refreshRootHiddenLive();
      }
    },
    [githubLogin, currentRefRef, setRoot, setSubCanvases, refreshHiddenLive, refreshRootHiddenLive],
  );

  return {
    hiddenLive,
    rootHiddenLive,
    refreshHiddenLive,
    refreshRootHiddenLive,
    handleRestoreLive,
  };
}
