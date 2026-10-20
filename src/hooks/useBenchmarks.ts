"use client";

import { useCallback, useEffect, useState } from "react";
import type { BenchmarkRun, BenchmarkRunDetail, BenchmarkTask } from "@/types/benchmarks";

const POLL_MS = 10_000;

function usePolling(reload: () => Promise<void>, active: boolean) {
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload]);
}

const base = (slug: string, benchmarkSlug: string) => `/api/workspaces/${slug}/benchmarks/${benchmarkSlug}`;

/** A benchmark's runs, newest first, refreshed while any is pending. */
export function useBenchmarkRuns(slug: string | undefined, benchmarkSlug: string) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`${base(slug, benchmarkSlug)}/runs`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Benchmark not found" : "Could not load runs");
      setRuns(((await res.json()) as { runs: BenchmarkRun[] }).runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load runs");
    } finally {
      setLoading(false);
    }
  }, [slug, benchmarkSlug]);

  usePolling(reload, runs.some((r) => r.status === "PENDING"));
  return { runs, loading, error, reload };
}

/** One run, polled while pending. */
export function useBenchmarkRun(slug: string | undefined, benchmarkSlug: string, runId: string) {
  const [run, setRun] = useState<BenchmarkRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`${base(slug, benchmarkSlug)}/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Run not found" : "Could not load the run");
      setRun(((await res.json()) as { run: BenchmarkRunDetail }).run);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the run");
    } finally {
      setLoading(false);
    }
  }, [slug, benchmarkSlug, runId]);

  usePolling(reload, run?.status === "PENDING");
  return { run, loading, error };
}

/** The benchmark's task list (empty when it has no list workflow). */
export function useBenchmarkTasks(slug: string | undefined, benchmarkSlug: string, enabled: boolean) {
  const [tasks, setTasks] = useState<BenchmarkTask[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${base(slug, benchmarkSlug)}/tasks`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not load tasks");
        return ((await res.json()) as { tasks: BenchmarkTask[] }).tasks;
      })
      .then((t) => !cancelled && (setTasks(t), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load tasks"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug, benchmarkSlug, enabled]);

  return { tasks, loading, error };
}
