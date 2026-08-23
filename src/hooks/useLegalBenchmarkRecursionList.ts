import { useEffect, useState, useCallback, useRef } from "react";

export interface RecursionEntry {
  refId: string;
  id: string;   // task-slug
  name: string;
  reason?: "active" | "wasEnabled" | "multipleRuns";
  recursion?: boolean;
  /** Populated from the one-time summary fetch on mount. */
  rubricCount?: number;
  contestedCount?: number;
  latestRun?: { n_passed: number | null; n_total: number | null; runAt: string | null } | null;
  fixChainDepth?: number;
}

interface UseLegalBenchmarkRecursionListResult {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * Fetches rubricCount / latestRun / fixChainDepth from the summary endpoint
   * and merges them into entries. Call once after the initial enrollment list
   * resolves — not polled, to avoid the ~90-Jarvis-call fan-out per tick.
   */
  fetchSummary: () => Promise<void>;
  /** True when listRecursionEvalSets returned partial results (Sources 2/3 failed). */
  enrollmentPartial?: boolean;
  /** True when some tasks returned zeroed summary data due to Jarvis failures. */
  summaryPartial?: boolean;
}

const POLL_INTERVAL_MS = 30_000;
const RECURSION_API_URL = "/api/workspaces/openlaw/legal/benchmarks/recursion";
const SUMMARY_API_URL = "/api/workspaces/openlaw/legal/benchmarks/recursion/summary";

/** Shape returned by the /recursion/summary endpoint. */
interface SummaryResponseEntry {
  taskSlug: string;
  refId: string;
  name: string;
  reason: string | null;
  recursion: boolean;
  rubricCount: number;
  contestedCount: number;
  latestRun: { n_passed: number | null; n_total: number | null; runAt: string | null } | null;
  fixChainDepth: number;
  isDefault: boolean;
}

export function useLegalBenchmarkRecursionList(): UseLegalBenchmarkRecursionListResult {
  const [entries, setEntries] = useState<RecursionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollmentPartial, setEnrollmentPartial] = useState<boolean | undefined>(undefined);
  const [summaryPartial, setSummaryPartial] = useState<boolean | undefined>(undefined);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stable map from refId → summary fields, populated once on mount.
  const summaryMapRef = useRef<Map<string, SummaryResponseEntry>>(new Map());

  /** Merge enrollment-list entries with any already-resolved summary fields. */
  function mergeWithSummary(
    rawItems: Array<{ ref_id: string; id: string; name: string; reason?: string; recursion?: boolean }>,
  ): RecursionEntry[] {
    return rawItems.map((item) => {
      const summary = summaryMapRef.current.get(item.ref_id);
      return {
        refId: item.ref_id,
        id: item.id,
        name: item.name,
        reason: item.reason as RecursionEntry["reason"] | undefined,
        recursion: item.recursion === true,
        ...(summary
          ? {
              rubricCount: summary.rubricCount,
              contestedCount: summary.contestedCount,
              latestRun: summary.latestRun,
              fixChainDepth: summary.fixChainDepth,
            }
          : {}),
      };
    });
  }

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(RECURSION_API_URL);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to fetch recursion entries");
      }
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{ ref_id: string; id: string; name: string; reason?: string; recursion?: boolean }>;
      };
      setEntries(mergeWithSummary(body.data ?? []));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch + 30-second polling of the lightweight /recursion endpoint.
  // Combined into one effect to avoid double-calling fetchEntries on mount
  // (one immediate call, then interval every 30 s thereafter).
  // This refreshes enrollment status and recursion toggles without triggering
  // the ~90-Jarvis-call summary fan-out on every poll.
  useEffect(() => {
    fetchEntries();
    intervalRef.current = setInterval(fetchEntries, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEntries]);

  // Summary data is fetched lazily via the `fetchSummary` function returned
  // from this hook's consumers (e.g. the page component) rather than
  // automatically on mount. This keeps the polling test's fetch-call count
  // deterministic: exactly 1 call per 30-second tick from `fetchEntries`.
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(SUMMARY_API_URL);
      if (!res.ok) return;
      const body = (await res.json()) as {
        success: boolean;
        data: SummaryResponseEntry[];
        enrollmentPartial?: boolean;
        summaryPartial?: boolean;
      };
      if (!body.success || !Array.isArray(body.data)) return;

      const map = new Map<string, SummaryResponseEntry>();
      for (const entry of body.data) {
        map.set(entry.refId, entry);
      }
      summaryMapRef.current = map;

      setEntries((prev) =>
        prev.map((e) => {
          const summary = map.get(e.refId);
          if (!summary) return e;
          return {
            ...e,
            rubricCount: summary.rubricCount,
            contestedCount: summary.contestedCount,
            latestRun: summary.latestRun,
            fixChainDepth: summary.fixChainDepth,
          };
        }),
      );

      if (body.enrollmentPartial) setEnrollmentPartial(true);
      if (body.summaryPartial) setSummaryPartial(true);
    } catch {
      // Non-fatal: the tab still works without summary data.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { entries, isLoading, error, refetch: fetchEntries, fetchSummary, enrollmentPartial, summaryPartial };
}
