"use client";

import { useState, useCallback, useRef } from "react";

export interface RepoBranch {
  name: string;
  sha: string;
}

interface UseRepoBranchesResult {
  branches: RepoBranch[];
  isLoading: boolean;
  error: string | null;
  fetchBranches: () => void;
}

/**
 * Hook to fetch branches for a repository from GitHub.
 * Fetches lazily — call `fetchBranches()` to trigger (e.g. on dropdown open).
 * @param repoUrl - The repository URL to fetch branches for
 * @param workspaceSlug - The workspace slug
 */
export function useRepoBranches(
  repoUrl: string | null,
  workspaceSlug: string | null,
): UseRepoBranchesResult {
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedRef = useRef<string | null>(null);

  const fetchBranches = useCallback(async () => {
    if (!repoUrl || !workspaceSlug) {
      setBranches([]);
      return;
    }

    const cacheKey = `${repoUrl}:${workspaceSlug}`;
    if (lastFetchedRef.current === cacheKey && branches.length > 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const perPage = 100;
      let page = 1;
      const accumulated: RepoBranch[] = [];

      while (true) {
        const params = new URLSearchParams({
          repoUrl,
          workspaceSlug,
          page: String(page),
          per_page: String(perPage),
        });
        const response = await fetch(`/api/github/repository/branches?${params}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch branches: ${response.statusText}`);
        }

        const result = await response.json();
        const pageBranches = (result.branches || result.data || result || []) as RepoBranch[];
        const pageArray = Array.isArray(pageBranches) ? pageBranches : [];
        accumulated.push(...pageArray);

        if (pageArray.length < perPage) break;
        page++;
      }

      setBranches(accumulated);
      lastFetchedRef.current = cacheKey;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setBranches([]);
    } finally {
      setIsLoading(false);
    }
  }, [repoUrl, workspaceSlug, branches.length]);

  return { branches, isLoading, error, fetchBranches };
}
