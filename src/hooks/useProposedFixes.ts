import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { ProposedFix } from "@/types/legal";

interface UseProposedFixesResult {
  fixes: ProposedFix[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches proposed fixes for a legal benchmark run from the graph via the
 * `/api/workspaces/[slug]/legal/benchmarks/proposed-fixes` endpoint.
 *
 * No automatic polling — call `refetch()` manually to re-check for fixes
 * that are still in a `pending`/`running` rerun_status.
 */
export function useProposedFixes(runId: string): UseProposedFixesResult {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;

  const [fixes, setFixes] = useState<ProposedFix[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFixes = useCallback(async () => {
    if (!slug || !runId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/workspaces/${slug}/legal/benchmarks/proposed-fixes?runId=${encodeURIComponent(runId)}`,
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      setFixes(Array.isArray(data.fixes) ? data.fixes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposed fixes");
    } finally {
      setIsLoading(false);
    }
  }, [slug, runId]);

  // Fetch on mount (and whenever slug/runId changes).
  useEffect(() => {
    fetchFixes();
  }, [fetchFixes]);

  return { fixes, isLoading, error, refetch: fetchFixes };
}
