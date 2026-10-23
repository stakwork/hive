"use client";

/**
 * The strut jobs on an initiative's infinite-canvas cards, live, for every
 * member viewing it (`docs/plans/infinite-canvas.md` §2.3–4;
 * `lib/canvas/canvas-jobs.ts`). Reads `GET …/strut/canvas-jobs` once, then
 * lays the org channel's `CANVAS_CARD_JOB` nudges over it. A nudge is ids
 * and state only, so a job the read has not returned yet, or one that just
 * settled, is read again (its title, who started it, its artifacts). While
 * a job on the initiative works or settles, its tree, brainstorms and the
 * list are read again too — strut writes the graph as it goes, and nothing
 * else says so.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "@/components/graph-workbench/queries";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import {
  applyCanvasJobNudge,
  canvasJobsByRef,
  type CanvasCardJobNudge,
  type CanvasJob,
} from "@/lib/canvas/canvas-jobs";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ArtifactRef } from "./canvasChatArtifacts";

export type { CanvasJob };

interface CanvasJobsResponse {
  jobs: CanvasJob[];
  artifactsByRef: Record<string, ArtifactRef[]>;
}

/** At most one tree re-read this often while a job keeps reporting (a walkthrough reports every second). */
const TREE_REFRESH_MS = 2_000;
/** Settles and new jobs come in bursts (an orchestrator turn starts several): one re-read for the burst. */
const READ_AGAIN_MS = 500;

const EMPTY_ARTIFACTS: Record<string, ArtifactRef[]> = {};
const NO_JOBS: CanvasJob[] = [];

export const canvasJobsKey = (githubLogin: string, initiativeRefId: string | null) =>
  ["canvas-jobs", githubLogin, initiativeRefId] as const;

export function useCanvasJobs(
  githubLogin: string,
  initiativeRefId: string | null,
): { jobsByRef: Record<string, CanvasJob[]>; artifactsByRef: Record<string, ArtifactRef[]> } {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: canvasJobsKey(githubLogin, initiativeRefId),
    queryFn: () =>
      getJson<CanvasJobsResponse>(
        `/api/orgs/${encodeURIComponent(githubLogin)}/strut/canvas-jobs?initiative=${encodeURIComponent(initiativeRefId!)}`,
      ),
    enabled: !!initiativeRefId,
    staleTime: 10_000,
    retry: 1,
  });

  // Nudges since the page opened this initiative.
  const [live, setLive] = useState<Record<string, CanvasCardJobNudge>>({});
  // Kept when already empty: a new object re-renders every card for nothing.
  useEffect(() => setLive((prev) => (Object.keys(prev).length ? {} : prev)), [initiativeRefId]);

  // The read as the handler sees it, without re-binding on every read.
  const read = useRef<CanvasJobsResponse | undefined>(data);
  useEffect(() => {
    read.current = data;
  }, [data]);

  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  useEffect(() => {
    if (!channel || !initiativeRefId) return;
    let treeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTreeRead = 0;
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    // The initiative's workspace, from its nudges: only its plan, list and brainstorms are read again.
    let ws = "";

    const readTrees = () => {
      lastTreeRead = Date.now();
      void qc.invalidateQueries({ queryKey: ["initiative-tree", ws, initiativeRefId] });
      void qc.invalidateQueries({ queryKey: ["initiatives", ws] });
      void qc.invalidateQueries({ queryKey: ["choice-tree", ws] });
    };
    const readTreesSoon = (now: boolean) => {
      if (treeTimer) clearTimeout(treeTimer);
      const wait = now ? 0 : Math.max(0, lastTreeRead + TREE_REFRESH_MS - Date.now());
      treeTimer = setTimeout(() => {
        treeTimer = null;
        readTrees();
      }, wait);
    };
    const readJobsSoon = () => {
      if (readTimer) return;
      readTimer = setTimeout(() => {
        readTimer = null;
        void qc.invalidateQueries({ queryKey: canvasJobsKey(githubLogin, initiativeRefId) });
      }, READ_AGAIN_MS);
    };

    const onNudge = (nudge: CanvasCardJobNudge) => {
      if (!nudge || nudge.initiativeRefId !== initiativeRefId) return;
      ws = nudge.workspaceSlug;
      setLive((prev) => applyCanvasJobNudge(prev, nudge, initiativeRefId));
      const known = read.current?.jobs.find((j) => j.jobId === nudge.jobId);
      if (!known || known.state !== nudge.state) readJobsSoon();
      readTreesSoon(nudge.state !== "running");
    };
    channel.bind(PUSHER_EVENTS.CANVAS_CARD_JOB, onNudge);
    return () => {
      channel.unbind(PUSHER_EVENTS.CANVAS_CARD_JOB, onNudge);
      if (treeTimer) clearTimeout(treeTimer);
      if (readTimer) clearTimeout(readTimer);
    };
  }, [channel, qc, githubLogin, initiativeRefId]);

  const jobs = data?.jobs ?? NO_JOBS;
  const jobsByRef = useMemo(() => canvasJobsByRef(jobs, live), [jobs, live]);
  return { jobsByRef, artifactsByRef: data?.artifactsByRef ?? EMPTY_ARTIFACTS };
}
