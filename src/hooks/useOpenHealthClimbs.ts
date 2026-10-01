"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { OpenHealthClimb, OpenHealthClimbsResponse } from "@/types/openhealth";

/** Poll cadence while a climb is in flight. */
const POLL_MS = 10_000;

/** The workspace's OpenHealth climbs, newest first, refreshed while any is running. */
export function useOpenHealthClimbs() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [climbs, setClimbs] = useState<OpenHealthClimb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug) return;
    try {
      const response = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/climbs`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load climbs");
      setClimbs(((await response.json()) as OpenHealthClimbsResponse).climbs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load climbs");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const running = climbs.some((climb) => climb.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  return { climbs, loading, error, reload };
}
