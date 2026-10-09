"use client";

/**
 * Queries the org's default-swarm concepts for the "/" concept-mention menu
 * in SidebarChat's composer.
 *
 * The server caps results at 20 and does the name filtering (see
 * `/api/orgs/[githubLogin]/concepts`), so this hook re-queries the server
 * with `?q=<query>` on every keystroke rather than filtering a single
 * cached "first 20" page client-side — otherwise a concept past the first
 * 20 in a large swarm could never be found by typing its name. Requests are
 * debounced ~150ms and cached per `(org, query)` pair; a slow, now-stale
 * response can't clobber a result for a newer query (tracked by comparing
 * against the most recently *requested* query, not response arrival order).
 */

import { useEffect, useRef, useState } from "react";

export interface OrgConcept {
  id: string;
  name: string;
}

interface ConceptsResult {
  concepts: OrgConcept[];
  noDefaultSwarm: boolean;
}

export interface UseOrgConceptsResult {
  concepts: OrgConcept[];
  noDefaultSwarm: boolean;
  isLoading: boolean;
}

const EMPTY_RESULT: ConceptsResult = { concepts: [], noDefaultSwarm: false };

const DEBOUNCE_MS = 150;

// Keyed by `${githubLogin}::${normalizedQuery}` — dedupes identical
// in-flight/completed requests across hook instances (tab switches,
// re-renders, multiple composer mounts) for the lifetime of the page.
const cache = new Map<string, Promise<ConceptsResult>>();

function cacheKey(githubLogin: string, query: string): string {
  return `${githubLogin}::${query}`;
}

function fetchConcepts(githubLogin: string, query: string): Promise<ConceptsResult> {
  const key = cacheKey(githubLogin, query);
  let pending = cache.get(key);
  if (!pending) {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    pending = fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/concepts${qs}`)
      .then(async (res) => {
        if (!res.ok) return EMPTY_RESULT;
        const data = await res.json();
        return {
          concepts: Array.isArray(data?.concepts) ? data.concepts : [],
          noDefaultSwarm: !!data?.noDefaultSwarm,
        };
      })
      .catch(() => EMPTY_RESULT);
    cache.set(key, pending);
    // Don't permanently cache a failed lookup — let a later request retry.
    pending.catch(() => cache.delete(key));
  }
  return pending;
}

/** Clears the cache — exported for tests only. */
export function __clearOrgConceptsCache() {
  cache.clear();
}

/**
 * `query` is `null` while the "/" menu is closed — the hook does not fetch
 * in that case and returns an empty, non-loading result. Pass the live
 * trigger query (e.g. `""` right after typing a bare "/") once the menu is
 * open.
 */
export function useOrgConcepts(githubLogin: string | undefined, query: string | null): UseOrgConceptsResult {
  const [result, setResult] = useState<ConceptsResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(false);

  // The most recently *requested* (debounce-fired) query. Used to drop a
  // response that resolves after a newer request has already superseded it.
  const latestRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!githubLogin || query === null) {
      setIsLoading(false);
      return;
    }

    const normalized = query.trim().toLowerCase();
    setIsLoading(true);

    const timer = setTimeout(() => {
      latestRequestRef.current = normalized;
      fetchConcepts(githubLogin, normalized).then((r) => {
        if (latestRequestRef.current !== normalized) return; // stale response
        setResult(r);
        setIsLoading(false);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [githubLogin, query]);

  return { concepts: result.concepts, noDefaultSwarm: result.noDefaultSwarm, isLoading };
}
