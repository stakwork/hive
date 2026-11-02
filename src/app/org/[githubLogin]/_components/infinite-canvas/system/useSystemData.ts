"use client";

/**
 * What the System view reads, besides the plan board the canvas already has:
 * the System Map nodes of the org's workspaces, every initiative's jobs (the
 * org-wide `canvas-jobs` read), and the stored IN_AREA / EXTENDS edges.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getJson } from "@/components/graph-workbench/queries";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { ALL_INITIATIVES, type CanvasCardJobNudge, type CanvasJob, canvasJobsByRef } from "@/lib/canvas/canvas-jobs";
import { DEFAULT_NODE_TYPES } from "@/lib/system-map/node-types";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { SystemMapDomainEdge, SystemMapDomainNode, SystemMapDomainNodesResponse } from "@/types/system-map";
import type { ArtifactRef } from "../../../_state/canvasChatArtifacts";
import { type EdgeMaps, type EdgeRow, EXTENDS, FEATURE_TYPE, IN_AREA, edgeMaps } from "./edges";

const NO_NODES: SystemMapDomainNode[] = [];
const NO_EDGES: SystemMapDomainEdge[] = [];
const NO_ARTIFACTS: Record<string, ArtifactRef[]> = {};
const NO_ROWS: EdgeRow[] = [];

const combineMaps = (results: Array<{ data?: SystemMapDomainNodesResponse; isLoading: boolean }>) => ({
  data: results.map((r) => r.data),
  loading: results.some((r) => r.isLoading),
});

/** The System Map of every workspace, merged (a node seen in two workspaces counts once, from the first). */
export function useSystemNodes(slugs: string[]) {
  const reads = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["system-map-nodes", slug, "canvas"],
      queryFn: () =>
        getJson<SystemMapDomainNodesResponse>(
          `/api/workspaces/${encodeURIComponent(slug)}/system-map/nodes?types=${DEFAULT_NODE_TYPES.join(",")}`,
        ),
      staleTime: 60_000,
      retry: false,
    })),
    combine: combineMaps,
  });
  const merged = useMemo(() => {
    const nodes = new Map<string, SystemMapDomainNode>();
    const ws = new Map<string, string>();
    const edges = new Map<string, SystemMapDomainEdge>();
    reads.data.forEach((d, i) => {
      if (d?.status !== "ready") return;
      for (const n of d.nodes)
        if (!nodes.has(n.refId)) {
          nodes.set(n.refId, n);
          ws.set(n.refId, slugs[i]);
        }
      for (const e of d.edges) edges.set(`${e.source}|${e.edgeType}|${e.target}`, e);
    });
    return { nodes: [...nodes.values()], edges: [...edges.values()], ws };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slugs are the queries' own order
  }, [reads.data]);
  const wsOf = useCallback((id: string) => merged.ws.get(id), [merged]);
  return {
    nodes: merged.nodes.length ? merged.nodes : NO_NODES,
    edges: merged.edges.length ? merged.edges : NO_EDGES,
    wsOf,
    loading: reads.loading,
  };
}

/** Every initiative's jobs of the org, live: any nudge on the org channel reads them again, shortly. */
export function useOrgCanvasJobs(githubLogin: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = useMemo(() => ["canvas-jobs", githubLogin, ALL_INITIATIVES] as const, [githubLogin]);
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      getJson<{ jobs: CanvasJob[]; artifactsByRef: Record<string, ArtifactRef[]> }>(
        `/api/orgs/${encodeURIComponent(githubLogin)}/strut/canvas-jobs?initiative=${ALL_INITIATIVES}`,
      ),
    enabled,
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.state === "running") ? 15_000 : 60_000),
    retry: 1,
  });
  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!channel || !enabled) return;
    const onNudge = (_n: CanvasCardJobNudge) => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: key });
      }, 500);
    };
    channel.bind(PUSHER_EVENTS.CANVAS_CARD_JOB, onNudge);
    return () => {
      channel.unbind(PUSHER_EVENTS.CANVAS_CARD_JOB, onNudge);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [channel, enabled, qc, key]);
  const jobs = data?.jobs;
  const jobsByRef = useMemo(() => canvasJobsByRef(jobs ?? [], {}), [jobs]);
  return { jobsByRef, artifactsByRef: data?.artifactsByRef ?? NO_ARTIFACTS };
}

type Target = { ws: string; type: string; id: string };

/** The stored IN_AREA / EXTENDS edges, and the writes. */
export function useSystemEdges(githubLogin: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = useMemo(() => ["system-edges", githubLogin] as const, [githubLogin]);
  const url = `/api/orgs/${encodeURIComponent(githubLogin)}/system-edges`;
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getJson<{ edges: EdgeRow[] }>(url),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
  const maps: EdgeMaps = useMemo(() => edgeMaps(data?.edges ?? NO_ROWS), [data]);

  const send = useMutation({
    mutationFn: async (args: { method: "PUT" | "DELETE"; body: unknown }) => {
      const res = await fetch(url, {
        method: args.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't save");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });
  const put = send.mutateAsync;
  const feature = (ws: string, id: string) => ({ ws, id });
  return {
    maps,
    saving: send.isPending,
    placeIn: (ws: string, id: string, to: Target) =>
      put({ method: "PUT", body: { type: IN_AREA, feature: feature(ws, id), to } }).catch(() => undefined),
    unplace: (ws: string, id: string) =>
      put({ method: "DELETE", body: { type: IN_AREA, feature: feature(ws, id) } }).catch(() => undefined),
    extend: (ws: string, id: string, to: { ws: string; id: string }) =>
      put({
        method: "PUT",
        body: { type: EXTENDS, feature: feature(ws, id), to: { ...to, type: FEATURE_TYPE } },
      }).catch(() => undefined),
    unextend: (ws: string, id: string) =>
      put({ method: "DELETE", body: { type: EXTENDS, feature: feature(ws, id) } }).catch(() => undefined),
  };
}
