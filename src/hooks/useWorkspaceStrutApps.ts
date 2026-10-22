"use client";

import { useEffect, useState } from "react";
import type { PinnedStrutApp } from "@/lib/strut-apps";

/** The workspace's pinned strut apps, and where they are (`GET /api/workspaces/:slug/strut/apps`). */
export interface WorkspaceStrutApps {
  /** Absent when the workspace has no swarm (then `apps` is empty). */
  githubLogin?: string;
  swarmId?: string;
  apps: PinnedStrutApp[];
}

/**
 * The apps the workspace's swarm has pinned as tabs. Read once per slug;
 * `null` slug reads nothing (a public viewer, no workspace yet). A failure
 * is `error`, never a throw: the sidebar shows no tabs, the app page says why.
 */
export function useWorkspaceStrutApps(slug: string | null | undefined): {
  data: WorkspaceStrutApps | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{ data: WorkspaceStrutApps | null; loading: boolean; error: string | null }>({
    data: null,
    loading: !!slug,
    error: null,
  });

  useEffect(() => {
    if (!slug) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/workspaces/${encodeURIComponent(slug)}/strut/apps`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<WorkspaceStrutApps> & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Could not read the workspace's apps (${res.status})`);
        return { ...body, apps: Array.isArray(body.apps) ? body.apps : [] } as WorkspaceStrutApps;
      })
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((e: unknown) => !cancelled && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}
