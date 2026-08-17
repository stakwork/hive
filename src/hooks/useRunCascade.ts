"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkflowStatus } from "@prisma/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { assembleRunCascade, mergeTurns } from "@/lib/legal-cascade/derive";
import type {
  CascadeSession,
  CascadeTurn,
  RunCascadeModel,
} from "@/lib/legal-cascade/types";

const POLL_INTERVAL_MS = 15_000;

/** Per-session turn-chain cursor state. */
interface TurnState {
  turns: CascadeTurn[];
  /** Max order seen — the `after` cursor for the next page. */
  maxOrder: number;
  /** turn_count at last fetch — the version counter; unchanged ⇒ skip. */
  fetchedTurnCount: number;
}

interface DetailState {
  turnCount: number;
  childCount: number;
  status: CascadeSession["status"];
}

interface UseRunCascadeOptions {
  /**
   * The cheap sessions-list fetch always runs (pill count/existence); the
   * full protocol — recursive details + cursored turn pages — only when the
   * panel is expanded.
   */
  enabled: boolean;
  /** The StakworkRun's own workflow status — keeps the list polling for new
   *  agents while the run is active even before any session is running. */
  runStatus?: WorkflowStatus | string;
}

export interface UseRunCascadeResult {
  /** Top-level agent sessions of the run (ordered upstream-arbitrary; the
   *  model orders them by start time). */
  sessions: CascadeSession[];
  /** Assembled cascade — null until the first full cycle after `enabled`. */
  model: RunCascadeModel | null;
  isLoading: boolean;
  error: string | null;
  /** Something is still executing — polling continues while true. */
  isLive: boolean;
  refetch: () => Promise<void>;
}

function isActiveRunStatus(status: UseRunCascadeOptions["runStatus"]): boolean {
  return status === WorkflowStatus.PENDING || status === WorkflowStatus.IN_PROGRESS;
}

/**
 * Live protocol per the plan's §1d — flat cost regardless of run size:
 * 1. Poll the run's session list on the section's standard 15s cadence.
 * 2. Diff `turn_count` per session against what's rendered; unchanged ⇒ skip.
 * 3. For each changed session, fetch its turn page with the order cursor
 *    (sequential — one to two in flight in practice).
 * 4. New sessions in the list are new agents starting; render immediately.
 * 5. Stop when no session is running and the run itself is terminal.
 *
 * Pusher STAKWORK_RUN_UPDATE acts as a refetch nudge, matching the legal
 * section's conventions (plain fetch + setInterval).
 */
export function useRunCascade(
  runId: string,
  { enabled, runStatus }: UseRunCascadeOptions,
): UseRunCascadeResult {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;

  const [sessions, setSessions] = useState<CascadeSession[]>([]);
  const [model, setModel] = useState<RunCascadeModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  const descendantsRef = useRef<Map<string, CascadeSession>>(new Map());
  const turnsRef = useRef<Map<string, TurnState>>(new Map());
  const detailRef = useRef<Map<string, DetailState>>(new Map());
  const isFetchingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(enabled);
  const runStatusRef = useRef(runStatus);
  enabledRef.current = enabled;
  runStatusRef.current = runStatus;

  const base = slug ? `/api/workspaces/${slug}/legal/benchmarks/cascade` : null;

  const runCycle = useCallback(async () => {
    if (!base || !runId || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const listRes = await fetch(`${base}/sessions?runId=${encodeURIComponent(runId)}`);
      if (!listRes.ok) throw new Error("Failed to fetch run sessions");
      const listBody = await listRes.json();
      const tops: CascadeSession[] = listBody?.data?.sessions ?? [];
      setSessions(tops);

      if (enabledRef.current) {
        // Recursive detail per top-level session with children — refreshed
        // while it runs (descendant turn counts only surface here).
        for (const top of tops) {
          const prev = detailRef.current.get(top.id);
          const needsDetail =
            top.child_count > 0 &&
            (!prev ||
              prev.turnCount !== top.turn_count ||
              prev.childCount !== top.child_count ||
              prev.status !== top.status ||
              top.status === "running");
          if (needsDetail) {
            const detRes = await fetch(
              `${base}/session?runId=${encodeURIComponent(runId)}&sessionId=${encodeURIComponent(top.id)}`,
            );
            if (detRes.ok) {
              const detBody = await detRes.json();
              const descendants: CascadeSession[] = detBody?.data?.descendants ?? [];
              for (const d of descendants) descendantsRef.current.set(d.id, d);
            }
          }
          detailRef.current.set(top.id, {
            turnCount: top.turn_count,
            childCount: top.child_count,
            status: top.status,
          });
        }

        const topIds = new Set(tops.map((t) => t.id));
        const descendants = [...descendantsRef.current.values()].filter(
          (d) => !topIds.has(d.id),
        );
        const allSessions = [...tops, ...descendants];

        // Cursored turn fetches — only where the version counter moved.
        for (const s of allSessions) {
          const state = turnsRef.current.get(s.id);
          if (state && state.fetchedTurnCount === s.turn_count) continue;
          const after = state?.maxOrder ?? -1;
          const turnsRes = await fetch(
            `${base}/turns?runId=${encodeURIComponent(runId)}&sessionId=${encodeURIComponent(s.id)}&after=${after}`,
          );
          if (!turnsRes.ok) continue; // retried next cycle — counter still differs
          const turnsBody = await turnsRes.json();
          const page = turnsBody?.data;
          const pageTurns: CascadeTurn[] = page?.turns ?? [];
          const merged = mergeTurns(state?.turns ?? [], pageTurns);
          turnsRef.current.set(s.id, {
            turns: merged,
            maxOrder: merged.length ? merged[merged.length - 1].order : after,
            fetchedTurnCount:
              typeof page?.turn_count === "number" ? page.turn_count : s.turn_count,
          });
        }

        const turnsBySession = new Map<string, CascadeTurn[]>();
        for (const [id, state] of turnsRef.current) turnsBySession.set(id, state.turns);
        setModel(assembleRunCascade(allSessions, turnsBySession));
      }

      const anyRunning =
        tops.some((s) => s.status === "running") ||
        [...descendantsRef.current.values()].some((s) => s.status === "running");
      // A run whose workflow is still active can start new agents (or its
      // first agent) at any moment — keep watching the list.
      setIsLive(anyRunning || isActiveRunStatus(runStatusRef.current));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
    }
  }, [base, runId]);

  const runCycleRef = useRef(runCycle);
  useEffect(() => {
    runCycleRef.current = runCycle;
  }, [runCycle]);

  // Initial fetch + refetch when the panel expands (history load).
  useEffect(() => {
    if (!base || !runId) return;
    runCycle();
  }, [base, runId, enabled, runCycle]);

  // Poll while live; stop when everything is terminal.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!isLive) return;
    intervalRef.current = setInterval(() => {
      runCycleRef.current?.();
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isLive]);

  // Pusher nudge — refetch on updates for this run.
  const channel = usePusherChannel(slug ? getWorkspaceChannelName(slug) : null);
  useEffect(() => {
    if (!channel) return;
    const handleUpdate = (data: { runId?: string; run_id?: string }) => {
      const updatedId = data.runId ?? data.run_id;
      if (updatedId && updatedId !== runId) return;
      runCycleRef.current?.();
    };
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    };
  }, [channel, runId]);

  return { sessions, model, isLoading, error, isLive, refetch: runCycle };
}
