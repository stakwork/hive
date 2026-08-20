"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, Plus, Send, Share2, Sparkles, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { filterProposalsForSession, latestReflection } from "@/lib/graph-chat/threads";
import { ConceptsPanel } from "@/components/agent-logs/LogDetailContent";
import type { ReflectedConcept } from "@/types/agent-logs";
import type { ConceptProposal, ConceptProposalListResponse } from "@/types/concept-proposals";
import type {
  GraphChatRun,
  GraphChatThread,
  GraphChatRunsResponse,
  GraphChatThreadsResponse,
} from "@/types/graph-chat";
import { ConceptProposalChip } from "./ConceptProposalChip";

/**
 * Right chat panel for the Graph Explorer — thread list plus thread view over
 * `AgentRun` rows (one row per prompt/result pair; a thread IS a sessionId).
 *
 * Fixed panel (not a Sheet) so it can stay open while interacting with the
 * graph — the node-properties Sheet already occupies the overlay pattern.
 * Local component state per the LogsChat/DashboardChat precedent — NOT the
 * org canvas chat store (CANVAS_CHAT.md forbids unifying with it).
 *
 * Live updates: subscribes to the workspace channel's
 * `graph-agent-run-updated` nudge and refetches; also poll-falls-back every
 * 20s while any run is PENDING (webhooks can be delayed).
 */

const POLL_INTERVAL_MS = 20_000;

/** Pusher nudge payload for a terminal graph run (see notifyGraphAgentRunUpdated). */
interface GraphRunNudge {
  runId: string;
  sessionId: string | null;
  status: string;
}

function StatusDot({ status }: { status: GraphChatThread["lastStatus"] }) {
  const cls =
    status === "PENDING" ? "bg-amber-500 animate-pulse" : status === "FAILED" ? "bg-rose-500" : "bg-emerald-500";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${cls}`} />;
}

export function GraphChatSidebar({
  workspaceSlug,
  activeSessionId,
  onSelectThread,
  onNewChat,
  onShowOnGraph,
  onClose,
}: {
  workspaceSlug: string;
  /** null → thread list view */
  activeSessionId: string | null;
  onSelectThread: (sessionId: string | null) => void;
  /** Starting a chat only makes sense from here, so the button lives here. */
  onNewChat: () => void;
  /**
   * Draw this thread's Concept reads on the canvas. The sidecar concepts ride
   * along as the fallback for when the session's graph edges never synced —
   * the explorer prefers the real AgentSession node when it can find it.
   */
  onShowOnGraph: (sessionId: string, sidecarConcepts: ReflectedConcept[]) => void;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<GraphChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [runs, setRuns] = useState<GraphChatRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [proposals, setProposals] = useState<ConceptProposal[]>([]);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/agent/runs`);
      if (res.ok) {
        const data: GraphChatThreadsResponse = await res.json();
        setThreads(data.threads ?? []);
      }
    } catch {
      // Non-fatal; the poll/nudge will retry.
    } finally {
      setThreadsLoading(false);
    }
  }, [workspaceSlug]);

  const fetchRuns = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/graph/agent/runs?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (res.ok) {
          const data: GraphChatRunsResponse = await res.json();
          setRuns(data.runs ?? []);
        }
      } catch {
        // Non-fatal; the poll/nudge will retry.
      } finally {
        setRunsLoading(false);
      }
    },
    [workspaceSlug],
  );

  // Thread-level proposals setting: snapshotted onto every run — derive from
  // the latest one (server enforces immutability anyway).
  const proposalsEnabled = runs.length > 0 && runs[runs.length - 1].proposalsEnabled;
  const anyPending = runs.some((r) => r.status === "PENDING");
  const anyCompleted = runs.some((r) => r.status === "DELIVERED_WEBHOOK");

  // Concepts the session read (stakgraph reflection sidecar) — cumulative,
  // so the latest run carrying a snapshot represents the whole thread.
  const reflection = useMemo(() => latestReflection(runs), [runs]);

  // Proposals filed from this thread's session. One unfiltered-status call —
  // decided proposals keep showing their outcome instead of vanishing.
  const fetchProposals = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`/api/learnings/concepts/proposals?workspace=${encodeURIComponent(workspaceSlug)}`);
        if (res.ok) {
          const data: ConceptProposalListResponse = await res.json();
          setProposals(filterProposalsForSession(data.proposals ?? [], sessionId));
        }
      } catch {
        // Non-fatal.
      }
    },
    [workspaceSlug],
  );

  // ── Initial + per-view fetches ────────────────────────────────────────────
  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    setRuns([]);
    setProposals([]);
    setError(null);
    if (activeSessionId) {
      setRunsLoading(true);
      fetchRuns(activeSessionId);
    }
  }, [activeSessionId, fetchRuns]);

  useEffect(() => {
    if (activeSessionId && proposalsEnabled && anyCompleted) {
      fetchProposals(activeSessionId);
    }
  }, [activeSessionId, proposalsEnabled, anyCompleted, fetchProposals]);

  // Keep the newest bubble in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [runs.length]);

  // ── Live updates: Pusher nudge + poll fallback while PENDING ─────────────
  const channel = usePusherChannel(getWorkspaceChannelName(workspaceSlug));
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;

  useEffect(() => {
    if (!channel) return;
    const handler = (payload: GraphRunNudge) => {
      fetchThreads();
      if (payload.sessionId && payload.sessionId === activeSessionRef.current) {
        fetchRuns(payload.sessionId);
      }
    };
    channel.bind(PUSHER_EVENTS.GRAPH_AGENT_RUN_UPDATED, handler);
    return () => {
      channel.unbind(PUSHER_EVENTS.GRAPH_AGENT_RUN_UPDATED, handler);
    };
  }, [channel, fetchThreads, fetchRuns]);

  const hasPendingSomewhere = anyPending || threads.some((t) => t.lastStatus === "PENDING");
  useEffect(() => {
    if (!hasPendingSomewhere) return;
    const interval = setInterval(() => {
      fetchThreads();
      if (activeSessionRef.current) fetchRuns(activeSessionRef.current);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasPendingSomewhere, fetchThreads, fetchRuns]);

  // ── Follow-up composer ────────────────────────────────────────────────────
  const send = useCallback(
    async (prompt: string) => {
      if (!activeSessionId || !prompt.trim() || sending) return;
      setSending(true);
      setError(null);
      try {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            sessionId: activeSessionId,
            proposalsEnabled,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { message?: string }).message || `Request failed (${res.status})`);
          return;
        }
        setComposerText("");
        await fetchRuns(activeSessionId);
        fetchThreads();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, sending, workspaceSlug, proposalsEnabled, fetchRuns, fetchThreads],
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.sessionId === activeSessionId) ?? null,
    [threads, activeSessionId],
  );

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l bg-background min-h-0" data-testid="graph-chat-sidebar">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {activeSessionId ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onSelectThread(null)}
              data-testid="graph-chat-back-button"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium truncate flex-1">{activeThread?.title ?? "Chat"}</span>
            {runs.length > 0 && (
              <Badge variant="secondary" className="text-[10px] shrink-0" data-testid="graph-chat-proposals-badge">
                <Sparkles className="h-3 w-3 mr-1" />
                Proposals {proposalsEnabled ? "on" : "off"}
              </Badge>
            )}
          </>
        ) : (
          <>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium flex-1">Graph chats</span>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onNewChat}
          title="New chat"
          data-testid="graph-chat-new-button"
        >
          <Plus className="h-4 w-4" />
        </Button>
        {activeSessionId && (
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onShowOnGraph(activeSessionId, reflection?.concepts ?? [])}
            title="Show this chat's concept reads on the graph"
            data-testid="graph-chat-show-on-graph-button"
          >
            <Share2 className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="graph-chat-close-button">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Body ── */}
      {activeSessionId ? (
        <>
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {runsLoading && runs.length === 0 && (
              <div className="flex justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {runs.map((run) => (
              <div key={run.id} className="space-y-2" data-testid={`graph-chat-run-${run.id}`}>
                {run.prompt && (
                  <div className="ml-8 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
                    {run.prompt}
                  </div>
                )}
                {run.status === "PENDING" && (
                  <div
                    className="mr-8 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
                    data-testid="graph-chat-pending-bubble"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Agent is working…
                  </div>
                )}
                {run.status === "DELIVERED_WEBHOOK" && run.result && (
                  <div className="mr-8 rounded-lg bg-muted px-3 py-2 text-sm">
                    <MarkdownRenderer size="compact">{run.result}</MarkdownRenderer>
                  </div>
                )}
                {run.status === "FAILED" && (
                  <div
                    className="mr-8 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-1"
                    data-testid="graph-chat-failed-bubble"
                  >
                    <p>Run failed{run.error ? `: ${run.error}` : "."}</p>
                    {run.prompt && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        disabled={sending || anyPending}
                        onClick={() => send(run.prompt!)}
                        data-testid="graph-chat-retry-button"
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {reflection && (
              <div className="pt-1" data-testid="graph-chat-concepts">
                <ConceptsPanel reflection={reflection} workspaceSlug={workspaceSlug} />
              </div>
            )}

            {proposals.length > 0 && (
              <div className="space-y-2 pt-1" data-testid="graph-chat-proposals">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  Concept proposals from this chat
                </p>
                {proposals.map((p) => (
                  <ConceptProposalChip key={p.id} proposal={p} workspaceSlug={workspaceSlug} />
                ))}
              </div>
            )}
          </div>

          {/* ── Composer ── */}
          <div className="border-t p-3 space-y-2">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 items-end">
              <Textarea
                rows={2}
                placeholder={anyPending ? "Waiting for the agent…" : "Ask a follow-up…"}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send(composerText);
                  }
                }}
                disabled={anyPending || sending}
                className="resize-none text-sm"
                data-testid="graph-chat-composer"
              />
              <Button
                size="icon"
                className="shrink-0"
                onClick={() => send(composerText)}
                disabled={anyPending || sending || !composerText.trim()}
                data-testid="graph-chat-send-button"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="graph-chat-thread-list">
          {threadsLoading && threads.length === 0 ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground px-4">
              <MessageSquare className="h-8 w-8" />
              <p className="text-sm">No graph chats yet.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={onNewChat}
                data-testid="graph-chat-empty-new-button"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New chat
              </Button>
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.sessionId}
                onClick={() => onSelectThread(thread.sessionId)}
                className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-accent transition-colors"
                data-testid={`graph-chat-thread-${thread.sessionId}`}
              >
                <StatusDot status={thread.lastStatus} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{thread.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(thread.updatedAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                {thread.proposalsEnabled && (
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Proposals enabled" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
