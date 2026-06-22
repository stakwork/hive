"use client";

import { useEffect, useState } from "react";

export const CREATE_NEW_VALUE = "__create_new__";

export interface EvalRequirement {
  ref_id: string;
  properties: {
    name: string;
    description?: string;
    order?: number;
  };
}

interface UseEvalRequirementsResult {
  requirements: EvalRequirement[];
  loading: boolean;
  error: string | null;
}

export function useEvalRequirements(
  slug: string,
  evalSetId: string | null | undefined
): UseEvalRequirementsResult {
  const [requirements, setRequirements] = useState<EvalRequirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No-op when empty, null, or CREATE_NEW sentinel
    if (!evalSetId || evalSetId === CREATE_NEW_VALUE) {
      setRequirements([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setRequirements([]);
    setError(null);
    setLoading(true);

    fetch(`/api/workspaces/${slug}/evals/${evalSetId}/requirements`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load requirements");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        // Normalize: nodes array or direct array
        const nodes: EvalRequirement[] =
          data?.data?.nodes ?? data?.data ?? data?.nodes ?? [];
        setRequirements(nodes);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load requirements");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, evalSetId]);

  return { requirements, loading, error };
}
