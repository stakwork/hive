"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasData } from "system-canvas-react";

const ROOT_KEY = "__root__";
const AUTOSAVE_MS = 600;

type DirtyMap = Map<string, CanvasData>;

async function fetchRoot(githubLogin: string): Promise<CanvasData> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas`);
  if (!res.ok) throw new Error(`Failed to load canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function fetchSub(githubLogin: string, ref: string): Promise<CanvasData> {
  const res = await fetch(
    `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`,
  );
  if (!res.ok) throw new Error(`Failed to load sub-canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function saveCanvas(
  githubLogin: string,
  ref: string | undefined,
  data: CanvasData,
): Promise<void> {
  const url = ref
    ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`
    : `/api/orgs/${githubLogin}/canvas`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    console.error(`[useCanvasPersistence] PUT failed (${res.status})`);
  }
}

export { fetchRoot, fetchSub, saveCanvas };

interface UseCanvasPersistenceOptions {
  githubLogin: string;
}

interface UseCanvasPersistenceReturn {
  root: CanvasData | null;
  setRoot: React.Dispatch<React.SetStateAction<CanvasData | null>>;
  subCanvases: Record<string, CanvasData>;
  setSubCanvases: React.Dispatch<React.SetStateAction<Record<string, CanvasData>>>;
  loadError: string | null;
  retryLoad: () => void;
  rootRef: React.RefObject<CanvasData | null>;
  subCanvasesRef: React.RefObject<Record<string, CanvasData>>;
  dirtyRef: React.RefObject<DirtyMap>;
  applyMutation: (
    canvasRef: string | undefined,
    mutate: (data: CanvasData) => CanvasData,
  ) => void;
  onResolveCanvas: (ref: string) => Promise<CanvasData>;
}

export function useCanvasPersistence({
  githubLogin,
}: UseCanvasPersistenceOptions): UseCanvasPersistenceReturn {
  const [root, setRoot] = useState<CanvasData | null>(null);
  const [subCanvases, setSubCanvases] = useState<Record<string, CanvasData>>(
    {},
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const subCanvasesRef = useRef(subCanvases);
  useEffect(() => {
    subCanvasesRef.current = subCanvases;
  }, [subCanvases]);
  const rootRef = useRef(root);
  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  const dirtyRef = useRef<DirtyMap>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      flushTimer.current = null;
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        void saveCanvas(githubLogin, ref, data);
      }
    }, AUTOSAVE_MS);
  }, [githubLogin]);

  const markDirty = useCallback(
    (canvasRef: string | undefined, next: CanvasData) => {
      dirtyRef.current.set(canvasRef ?? ROOT_KEY, next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // Initial root load.
  useEffect(() => {
    let cancelled = false;
    fetchRoot(githubLogin)
      .then((data) => {
        if (!cancelled) setRoot(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[useCanvasPersistence] failed to load root", err);
          setLoadError("Failed to load canvas");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  // Flush pending saves on unmount.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        void saveCanvas(githubLogin, ref, data);
      }
    };
  }, [githubLogin]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    fetchRoot(githubLogin)
      .then((data) => setRoot(data))
      .catch((err) => {
        console.error("[useCanvasPersistence] retry load failed", err);
        setLoadError("Failed to load canvas");
      });
  }, [githubLogin]);

  const applyMutation = useCallback(
    (
      canvasRef: string | undefined,
      mutate: (data: CanvasData) => CanvasData,
    ) => {
      if (!canvasRef) {
        const current = rootRef.current;
        if (!current) return;
        const next = mutate(current);
        setRoot(next);
        markDirty(undefined, next);
        return;
      }
      const current = subCanvasesRef.current[canvasRef];
      if (!current) return;
      const next = mutate(current);
      setSubCanvases((prev) => ({ ...prev, [canvasRef]: next }));
      markDirty(canvasRef, next);
    },
    [markDirty],
  );

  const onResolveCanvas = useCallback(
    async (ref: string): Promise<CanvasData> => {
      const cached = subCanvasesRef.current[ref];
      if (cached) return cached;
      const data = await fetchSub(githubLogin, ref);
      setSubCanvases((prev) => ({ ...prev, [ref]: data }));
      return data;
    },
    [githubLogin],
  );

  return {
    root,
    setRoot,
    subCanvases,
    setSubCanvases,
    loadError,
    retryLoad,
    rootRef,
    subCanvasesRef,
    dirtyRef,
    applyMutation,
    onResolveCanvas,
  };
}
