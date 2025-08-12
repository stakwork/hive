"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

interface SwarmTestsConfig {
  baseUrl: string | null;
  apiKey?: string | null;
  loading: boolean;
  error?: string | null;
}

function getUseMocks(): boolean {
  // const flag = process.env.USE_MOCK_TESTS || "";
  // console.log("USE_MOCK_TESTS", flag);
  // return flag === "1" || flag.toLowerCase() === "true";
  return true;
}

export function useSwarmTestsConfig(): SwarmTestsConfig {
  const params = useParams<{ slug?: string }>();
  const slug = useMemo(
    () => (params?.slug ? String(params.slug) : ""),
    [params],
  );
  const [state, setState] = useState<SwarmTestsConfig>({
    baseUrl: null,
    apiKey: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (getUseMocks()) {
          if (!cancelled)
            setState({
              baseUrl: "/api/mock",
              apiKey: null,
              loading: false,
            });
          return;
        }

        if (!slug) {
          if (!cancelled)
            setState({
              baseUrl: null,
              apiKey: null,
              loading: false,
              error: "Missing workspace slug",
            });
          return;
        }

        const res = await fetch(`/api/workspaces/${slug}/stakgraph`);
        const body = await res.json();
        if (!res.ok || !body?.success) {
          throw new Error(body?.message || "Failed to load swarm settings");
        }
        const data = body.data || {};
        const swarmUrl: string | undefined = data.swarmUrl;
        const swarmApiKey: string | undefined =
          data.swarmSecretAlias || data.swarmApiKey;

        if (!swarmUrl) {
          throw new Error("Swarm URL not configured");
        }

        if (!cancelled)
          setState({
            baseUrl: swarmUrl,
            apiKey: swarmApiKey ?? null,
            loading: false,
          });
      } catch (e) {
        if (!cancelled)
          setState({
            baseUrl: null,
            apiKey: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}
