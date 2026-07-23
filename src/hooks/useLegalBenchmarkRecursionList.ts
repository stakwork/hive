import { useEffect, useState, useCallback, useRef } from "react";

export interface RecursionEntry {
  refId: string;
  id: string;   // task-slug
  name: string;
  recursion: boolean;
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to fetch recursion entries");
      }
      const body = (await res.json()) as { success: boolean; data: Array<{ ref_id: string; id: string; name: string; recursion: boolean }> };
      const mapped: RecursionEntry[] = (body.data ?? []).map((item) => ({
        refId: item.ref_id,
        id: item.id,
        name: item.name,
        recursion: item.recursion,
      }));
      setEntries(mapped);
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

  // Always-on polling
  useEffect(() => {
    intervalRef.current = setInterval(fetchEntries, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEntries]);

  return { entries, isLoading, error, refetch: fetchEntries };
}
