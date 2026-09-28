"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { OpenHealthRun, OpenHealthRunsResponse } from "@/types/openhealth";

/** Poll cadence while a run is in flight. */
const POLL_MS = 10_000;

/** The workspace's OpenHealth benchmark runs, newest first, refreshed while any is in flight. */
export function useOpenHealthRuns() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [runs, setRuns] = useState<OpenHealthRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug) return;
    try {
      const response = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/runs`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load runs");
      setRuns(((await response.json()) as OpenHealthRunsResponse).runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load runs");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inFlight = runs.some((run) => run.outcome === "running");
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, reload]);

  return { runs, loading, error, reload };
}
