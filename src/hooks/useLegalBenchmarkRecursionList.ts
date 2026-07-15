import { useEffect, useState, useCallback, useRef } from "react";
import type { RecursionStatus } from "@prisma/client";

export interface RecursionEntry {
  id: string;
  workspaceId: string;
  taskSlug: string;
  status: RecursionStatus;
  runId: string;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastScore: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UseLegalBenchmarkRecursionListResult {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;
const RECURSION_API_URL = "/api/workspaces/openlaw/legal/benchmarks/recursion";

export function useLegalBenchmarkRecursionList(): UseLegalBenchmarkRecursionListResult {
  const [entries, setEntries] = useState<RecursionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(RECURSION_API_URL);
      if (!res.ok) throw new Error("Failed to fetch recursion entries");
      const data = (await res.json()) as RecursionEntry[];
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Always-on polling — entries are long-lived ACTIVE/RUNNING states
  useEffect(() => {
    intervalRef.current = setInterval(fetchEntries, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEntries]);

  return { entries, isLoading, error, refetch: fetchEntries };
}
