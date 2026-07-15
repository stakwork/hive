import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { ProposedFix } from "@/types/legal";

export interface UseProposedFixesResult {
  fixes: ProposedFix[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  accept: (refId: string) => Promise<void>;
  reject: (refId: string) => Promise<void>;
  pendingRefIds: Set<string>;
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
  // Ref for synchronous guard (avoids stale-closure double-submission).
  const pendingRefIdsRef = useRef<Set<string>>(new Set());
  // State for rendering (mirrors the ref, updated on add/remove).
  const [pendingRefIds, setPendingRefIds] = useState<Set<string>>(new Set());

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

  const mutate = useCallback(
    async (refId: string, action: "accept" | "reject") => {
      if (!slug || !refId) return;
      // Synchronous guard via ref — prevents double-submission even before re-render.
      if (pendingRefIdsRef.current.has(refId)) return;

      pendingRefIdsRef.current.add(refId);
      setPendingRefIds(new Set(pendingRefIdsRef.current));

      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/proposed-fixes/${encodeURIComponent(refId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Request failed with status ${res.status}`);
        }

        // Read-after-write: reconcile from server.
        await fetchFixes();
      } finally {
        pendingRefIdsRef.current.delete(refId);
        setPendingRefIds(new Set(pendingRefIdsRef.current));
      }
    },
    [slug, fetchFixes],
  );

  const accept = useCallback((refId: string) => mutate(refId, "accept"), [mutate]);
  const reject = useCallback((refId: string) => mutate(refId, "reject"), [mutate]);

  return { fixes, isLoading, error, refetch: fetchFixes, accept, reject, pendingRefIds };
}
