"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  FileIcon,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  OctagonX,
  Paperclip,
  Plus,
  RefreshCw,
  Share2,
  Split,
  X,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { useVoiceCorrectionCapture } from "@/hooks/useVoiceCorrectionCapture";
import { useVoiceLearningPreference } from "@/hooks/useVoiceLearningPreference";
import { CanvasHistoryPopover } from "./CanvasHistoryPopover";
import { CanvasAgentSettingsPopover } from "./CanvasAgentSettingsPopover";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { StreamingMessage } from "@/components/streaming";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SidebarChatMessage } from "./SidebarChatMessage";
import { ProposalCard, getProposalsFromMessage, sortProposalsByDependency } from "./ProposalCard";
import { PROPOSE_FEATURE_TOOL, PROPOSE_INITIATIVE_TOOL, PROPOSE_MILESTONE_TOOL } from "@/lib/proposals/types";
import { SubAgentRunCard, getSubAgentRunsFromMessages } from "./SubAgentRunCard";
import { ResearchRunCard, getResearchRunsFromMessages } from "./ResearchRunCard";
import { HtmlPageCard, getHtmlPagesFromMessages } from "./HtmlPageCard";
import { PlannerFormSlot } from "./PlannerFormSlot";
import { StartTasksSlot } from "./StartTasksSlot";
import { DeferredCheckCard } from "./DeferredCheckCard";
import { DailyRecapCard } from "@/components/daily-recap/DailyRecapCard";

import {
  useCanvasChatStore,
  timelineFromToolCalls,
  type CanvasAttachment,
  type CanvasChatMessage,
  type ToolCall,
} from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";
import { forkCanvasConversation } from "../_state/forkCanvasConversation";
import { startNewOrgConversation } from "../_state/openOrgConversation";
import { ActionTip } from "./ActionTip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { jamieName } from "@/lib/constants/jamie";
import { useCanvasAgentActivity } from "@/hooks/useCanvasAgentActivity";
import { uploadFileToS3 } from "@/lib/upload-image-to-s3";
import { useFileDrop } from "@/hooks/useFileDrop";
import { StreamScrollIndicator } from "@/components/dashboard/DashboardChat/StreamScrollIndicator";

/**
 * Org-canvas sidebar chat. Renders the active conversation from the
 * canvas chat store; never owns chat state itself. Mounting and
 * unmounting (e.g. when the user switches to the Details tab) is
 * cheap and idempotent — the store survives.
 *
 * The conversation's *lifecycle* (creation, share preload, auto-
 * save) is owned by `OrgCanvasView`. This component only handles:
 *   - rendering the message scroll
 *   - sending new messages (via `useSendCanvasChatMessage`)
 *   - the Share + Clear header actions
 *
 * Reuses `ToolCallIndicator` and `useStreamProcessor` from the
 * dashboard chat unchanged. Bubbles are rendered by the local
 * `SidebarChatMessage` instead — the dashboard's `ChatMessage`
 * centers everything, which doesn't fit a narrow sidebar where we
 * want user messages right-aligned and assistant messages left-
 * aligned.
 */
/** Chat input grows with its content (Shift+Enter adds lines) up to this, then scrolls. */

interface SidebarChatProps {
  /** Slug of the org. Used by the Share button to scope the POST. */
  githubLogin: string;
  /**
   * Hide the history popover and the new-chat button in the header.
   * The control panel lists every chat and owns "New" in its own
   * column, so those controls would be duplicates there.
   */
}

export function SidebarChat({ githubLogin }: SidebarChatProps) {
  // ─── Selectors — narrow on purpose ─────────────────────────────────
  // Each selector returns a primitive or a stable reference so
  // streaming text-deltas don't trigger re-renders in selectors that
  // didn't change. Never select the whole conversation object — the
  // header's "Share" button only needs `messages.length > 0`, the
  // message list needs `messages` + `activeToolCalls` + `isLoading`.
  const activeId = useCanvasChatStore((s) => s.activeConversationId);
  const messages = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.messages : undefined) ?? EMPTY_MESSAGES,
  );
  const isLoading = useCanvasChatStore((s) => (activeId ? s.conversations[activeId]?.isLoading : false) ?? false);
  // Refcount of unsettled agent turns in this conversation — unlike
  // `isLoading` (cleared on the first stream chunk), this stays > 0 for
  // the full send→finally lifetime of every in-flight turn, so the
  // thinking dots survive turns that open with a tool call and stay
  // justified while a second overlapping turn (e.g. a proposal
  // approval) is still streaming. See `CanvasConversation.agentTurnsInProgress`.
  const agentTurnsInProgress = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.agentTurnsInProgress : 0) ?? 0,
  );
  const activeToolCalls = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.activeToolCalls : undefined) ?? EMPTY_TOOL_CALLS,
  );
  // True for the full lifetime of a streaming response (the last message
  // renders as streaming until it settles).
  const isStreaming = useCanvasChatStore((s) => (activeId ? s.conversations[activeId]?.isStreaming : false) ?? false);

  const { id: workspaceId } = useWorkspace();

  const sendMessage = useSendCanvasChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // The whole chat is the drop target — header, messages and composer —
  // not just the textarea. Dropped files land in the composer as
  // attachments through its handle.
  const composerRef = useRef<SidebarChatInputHandle>(null);
  const { isDragging, dragProps } = useFileDrop<HTMLDivElement>({
    onDrop: (files) => composerRef.current?.addFiles(files),
  });
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isProgrammaticScrollRef = useRef(false);
  const mouseDownRef = useRef(false); // true while primary mouse button is held
  const isMouseDragRef = useRef(false); // true only after movement detected — not on simple clicks

  // Reset drag flag on conversation switch. Declared BEFORE the auto-scroll
  // effect so React runs it first within the same render — clearing the flag
  // before the scroll effect reads it.
  useEffect(() => {
    isMouseDragRef.current = false;
  }, [activeId]);

  // Scroll to bottom on updates unless the user has manually scrolled up,
  // a text-selection drag is in progress, or a non-collapsed selection exists.
  useEffect(() => {
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed; // secondary fallback: keyboard/prior selection
    if (!userScrolledUp && !isMouseDragRef.current && !hasSelection) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeToolCalls, isLoading, userScrolledUp]);

  // Bind drag-tracking listeners to the scroll container.
  // Two-phase: mousedown sets the "button held" flag; mousemove promotes it to
  // "confirmed drag" so quick button clicks never suppress auto-scroll.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onMouseDown = () => {
      mouseDownRef.current = true;
    };
    const onMouseMove = () => {
      if (mouseDownRef.current) isMouseDragRef.current = true;
    };
    const onRelease = () => {
      mouseDownRef.current = false;
      isMouseDragRef.current = false;
    };

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onRelease); // catches release outside container
    window.addEventListener("blur", onRelease); // mouse released outside browser window
    document.addEventListener("visibilitychange", onRelease); // tab switch mid-drag

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onRelease);
      window.removeEventListener("blur", onRelease);
      document.removeEventListener("visibilitychange", onRelease);
    };
  }, []); // scrollRef's host div is unconditionally rendered — structurally stable

  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    setUserScrolledUp(!atBottom);
  };

  const handleSend = async (content: string, attachments: CanvasAttachment[], clearInput: () => void) => {
    if (!activeId) return;
    await sendMessage({
      conversationId: activeId,
      content,
      attachments,
      onResponseStart: () => clearInput(),
    });
  };

  const hasMessages = messages.length > 0;

  // Group all `send_to_feature_planner` calls in this conversation
  // by featureId, then bucket the resulting runs by the message they
  // should hang under (the most recent send for that feature). This
  // lets one card render even when the agent has messaged the same
  // planner multiple times — the card moves down with the latest
  // exchange. See `SubAgentRunCard.tsx` for the design rationale.
  const subAgentRunsByAnchor = useMemo(() => {
    const runs = getSubAgentRunsFromMessages(messages);
    const byAnchor = new Map<string, typeof runs>();
    for (const run of runs) {
      const existing = byAnchor.get(run.anchorMessageId);
      if (existing) {
        existing.push(run);
      } else {
        byAnchor.set(run.anchorMessageId, [run]);
      }
    }
    return byAnchor;
  }, [messages]);

  // Group dispatched research runs by their anchor message, mirroring the
  // subAgentRunsByAnchor pattern. Inbound fan-out rows win the anchor.
  const researchRunsByAnchor = useMemo(() => {
    const runs = getResearchRunsFromMessages(messages);
    const byAnchor = new Map<string, typeof runs>();
    for (const run of runs) {
      const existing = byAnchor.get(run.anchorMessageId);
      if (existing) existing.push(run);
      else byAnchor.set(run.anchorMessageId, [run]);
    }
    return byAnchor;
  }, [messages]);

  // Group saved/updated HTML pages by their anchor message, mirroring the
  // researchRunsByAnchor pattern. Derived from the timeline's tool calls —
  // canvas artifacts aren't persisted by autosave, so the tool output is
  // the only source that survives reload / share / live-sync.
  const htmlPagesByAnchor = useMemo(() => {
    const pages = getHtmlPagesFromMessages(messages, githubLogin);
    const byAnchor = new Map<string, typeof pages>();
    for (const page of pages) {
      const existing = byAnchor.get(page.anchorMessageId);
      if (existing) existing.push(page);
      else byAnchor.set(page.anchorMessageId, [page]);
    }
    return byAnchor;
  }, [messages, githubLogin]);

  // Render the SubAgentRunCard(s) anchored to a message. Extracted so it
  // can render under BOTH a normal message AND a suppressed fan-out
  // message (an inbound planner reply / form-answer — whose bubble is
  // hidden but which is the anchor for an inbound-only run, e.g. the
  // approval flow where the agent never made an outbound
  // `send_to_feature_planner` call).
  const renderSubAgentRuns = (runs: ReturnType<typeof getSubAgentRunsFromMessages>) => (
    <div className="space-y-1.5">
      {runs.map((run) => (
        <div key={run.featureId} className="space-y-1.5">
          <SubAgentRunCard run={run} />
          {/*
            Phase 4: an unanswered planner FORM surfaces OUTSIDE the
            collapsed card so the user can answer it inline without
            expanding or leaving canvas chat. Only the run with a
            `pendingForm` renders a slot.
          */}
          {run.pendingForm && (
            <PlannerFormSlot
              githubLogin={githubLogin}
              featureId={run.featureId}
              featureTitle={run.featureTitle}
              plannerMessageId={run.pendingForm.plannerMessageId}
              questions={run.pendingForm.questions}
            />
          )}
          {/*
            Offer a Start Tasks button once the planner has replied at
            all — NOT just when a reply carried a `TASKS` artifact.
            Tasks created by the remote planner over MCP
            (`create_task` / `create_feature_task`) hit the DB directly
            with no artifact, no chat message, and no fan-out, so
            `run.hasGeneratedTasks` (artifact-derived) stays false even
            though real tasks exist. The slot itself reads the live
            ready-count (`GET …/tasks/assign-all`) and renders nothing
            when zero, so showing it for any answered run is safe — the
            count is the artifact-independent source of truth. We pass
            `revalidateKey` (the anchor, which moves on each new planner
            reply) so a closing "tasks created" message re-queries the
            count and surfaces the button live. Suppressed while a FORM
            is pending — answer the planner first.
          */}
          {!run.pendingForm && run.messages.some((m) => m.direction === "in") && (
            <StartTasksSlot
              featureId={run.featureId}
              featureTitle={run.featureTitle}
              revalidateKey={run.anchorMessageId}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative flex h-full flex-col min-h-0" {...dragProps}>
      {isDragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5"
        >
          <span className="rounded-lg border bg-background/95 px-3 py-1.5 text-sm font-medium text-primary shadow-sm">
            Drop files to attach
          </span>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto h-full px-4 py-3">
          <DailyRecapCard dismissible showActivityLink />
          {!hasMessages && activeToolCalls.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                <MessageCircle className="h-4 w-4" />
              </span>
              <p className="text-sm font-medium">Message {jamieName}</p>
              <p className="max-w-[260px] text-xs text-muted-foreground">
                Ask about the org, start a plan, or check on what&apos;s running.
              </p>
            </div>
          )}
          <div className="space-y-2">
            {messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;
              // `isStreaming` (true until the stream settles), NOT `isLoading`
              // (cleared on the first chunk) — with isLoading every row
              // rendered as "done" the moment anything streamed in.
              const isMessageStreaming = isLastMessage && isStreaming;

              // User messages that ride structured Approve / Reject
              // intents are not chat content for the user — the proposal
              // card transition is the visual feedback. Suppress the
              // bubble entirely; the message stays in the JSON for the
              // route handler to detect on subsequent clicks and for
              // status derivation across forks.
              if (message.role === "user" && (message.approval || message.rejection)) {
                return null;
              }

              const subAgentRuns = subAgentRunsByAnchor.get(message.id);

              // Fan-out messages from planners (and Phase 4's planner-
              // form answers) don't render as top-level chat bubbles —
              // BUT they're the anchor for inbound-only runs (the approval
              // flow: the agent never made an outbound
              // `send_to_feature_planner` call, so the planner's reply is
              // the only activity and thus the anchor). Suppress the
              // bubble, but still render any SubAgentRunCard anchored
              // here, otherwise the card disappears the moment the planner
              // replies. They stay in the messages array so
              // `getSubAgentRunsFromMessages` can walk them and so they
              // round-trip through autosave / share. See
              // `docs/plans/canvas-agent-manages-planners.md` Phase 2.
              const researchRuns = researchRunsByAnchor.get(message.id);
              const htmlPages = htmlPagesByAnchor.get(message.id);

              if (
                message.source?.kind === "planner" ||
                message.source?.kind === "user-answered-planner-form" ||
                message.source?.kind === "research"
              ) {
                if ((!subAgentRuns || subAgentRuns.length === 0) && (!researchRuns || researchRuns.length === 0))
                  return null;
                return (
                  <div key={message.id} className="space-y-1.5">
                    {subAgentRuns && renderSubAgentRuns(subAgentRuns)}
                    {researchRuns?.map((run) => (
                      <ResearchRunCard key={run.researchId} run={run} githubLogin={githubLogin} />
                    ))}
                  </div>
                );
              }

              const proposals = getProposalsFromMessage(message);

              // Collect tool-call IDs that produced a ProposalCard (successful
              // proposal outputs only — failed calls stay in the timeline).
              const proposalToolCallIds = new Set<string>();
              if (proposals.length > 0) {
                for (const tc of message.toolCalls ?? []) {
                  if (
                    tc.toolName !== PROPOSE_FEATURE_TOOL &&
                    tc.toolName !== PROPOSE_INITIATIVE_TOOL &&
                    tc.toolName !== PROPOSE_MILESTONE_TOOL
                  )
                    continue;
                  const o = tc.output;
                  if (!o || typeof o !== "object" || "error" in o) continue;
                  proposalToolCallIds.add(tc.id);
                }
              }

              // The streamed (live) path attaches a rich `timeline` to
              // tool-call rows. The server only persists `toolCalls`, so a
              // reloaded / shared / live-synced row has `toolCalls` but no
              // `timeline` — synthesize one from `toolCalls` so its tool
              // cards render identically to a live turn.
              const effectiveTimeline =
                message.timeline ?? (message.toolCalls?.length ? timelineFromToolCalls(message.toolCalls) : undefined);

              const filteredTimeline =
                proposalToolCallIds.size > 0
                  ? effectiveTimeline?.filter((item) => item.type !== "toolCall" || !proposalToolCallIds.has(item.id))
                  : effectiveTimeline;

              // A streamed tool-call row carries a `timeline` (and empty
              // text content). Render it as rich, expandable tool cards via
              // the shared `<StreamingMessage>` — names, args, outputs, and
              // live status, in order with any interleaved text. Plain text
              // rows fall through to `SidebarChatMessage` so the bubble look
              // and the `?r=`/`?c=` deep-link interceptor are preserved.
              const hasTimeline = !!filteredTimeline?.length;

              return (
                <div key={message.id} className="space-y-1.5">
                  {hasTimeline ? (
                    <div className="w-full text-foreground/90">
                      <StreamingMessage
                        message={{
                          id: message.id,
                          content: message.content,
                          timeline: filteredTimeline,
                          isStreaming: isMessageStreaming,
                          usage: message.usage,
                        }}
                      />
                    </div>
                  ) : (
                    <SidebarChatMessage message={message} isStreaming={isMessageStreaming} />
                  )}
                  {proposals.length > 0 && (
                    <div className="space-y-1.5">
                      {sortProposalsByDependency(proposals).map((p) => (
                        <ProposalCard
                          key={p.proposalId}
                          proposal={p}
                          messageId={message.id}
                          githubLogin={githubLogin}
                          messageTimestamp={message.timestamp}
                        />
                      ))}
                    </div>
                  )}
                  {message.deferredCheck && (
                    <DeferredCheckCard deferredCheck={message.deferredCheck} githubLogin={githubLogin} />
                  )}
                  {subAgentRuns && subAgentRuns.length > 0 && renderSubAgentRuns(subAgentRuns)}
                  {researchRuns &&
                    researchRuns.length > 0 &&
                    researchRuns.map((run) => (
                      <ResearchRunCard key={run.researchId} run={run} githubLogin={githubLogin} />
                    ))}
                  {htmlPages &&
                    htmlPages.length > 0 &&
                    htmlPages.map((page) => <HtmlPageCard key={page.slug} page={page} githubLogin={githubLogin} />)}
                  <MessageArtifacts artifactIds={message.artifactIds} />
                </div>
              );
            })}
            <AnimatePresence>
              {agentTurnsInProgress > 0 && activeToolCalls.length === 0 && (
                <motion.div
                  key="thinking-dots"
                  data-testid="thinking-dots"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex justify-start"
                >
                  <div className="rounded-2xl px-3 py-2 bg-muted/40 shadow-sm">
                    <div className="flex gap-1 items-center h-4">
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                        className="text-sm text-foreground/60"
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                        className="text-sm text-foreground/60"
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                        className="text-sm text-foreground/60"
                      >
                        .
                      </motion.span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>
        <StreamScrollIndicator
          isStreaming={isLoading}
          userScrolledUp={userScrolledUp}
          showBackButton={false}
          onStreamingClick={() => {
            isProgrammaticScrollRef.current = true;
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setUserScrolledUp(false);
          }}
          onLatestClick={() => {
            isProgrammaticScrollRef.current = true;
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setUserScrolledUp(false);
          }}
          onBackClick={() => {}}
        />
      </div>{" "}
      {/* end relative wrapper */}
      <div className="border-t p-2">
        <SidebarChatInput
          ref={composerRef}
          onSend={handleSend}
          disabled={isLoading}
          workspaceId={workspaceId}
          orgId={githubLogin}
        />
      </div>
    </div>
  );
}

/**
 * The chat header's actions — the agent-active dot, Stop, the share
 * link, Fork, agent settings, history (unless `hideHistory`: the control
 * panel's list is the history) and New chat. Reads the store itself, so
 * the chat's own header and the org page's one bar can both place it.
 */
export function SidebarChatActions({
  githubLogin,
  hideHistory = false,
}: {
  githubLogin: string;
  hideHistory?: boolean;
}) {
  const activeId = useCanvasChatStore((s) => s.activeConversationId);
  const hasMessages = useCanvasChatStore((s) => ((activeId ? s.conversations[activeId]?.messages.length : 0) ?? 0) > 0);
  // The persisted row id. Sharing flips this row to `isShared` and hands
  // out its id, so the sharer and every joiner live in the *same* room.
  // Null until the first turn has created the row — Share/Fork are gated on it.
  const serverConversationId = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.serverConversationId : null) ?? null,
  );
  // The source must be persisted before it is forked, so Fork stays
  // disabled until streaming ends.
  const isStreaming = useCanvasChatStore((s) => (activeId ? s.conversations[activeId]?.isStreaming : false) ?? false);
  // runActive: driven by local tool-call detection (via setRunActive called from
  // useSendCanvasChatMessage) AND by the Pusher CANVAS_RUN_ACTIVE event (for
  // all participants including non-initiators, bound in useCanvasChatAutoSave).
  const runActive = useCanvasChatStore((s) => (activeId ? s.conversations[activeId]?.runActive : false) ?? false);
  // stopRun action — posts to /api/ask/abort without exposing request_id.
  const stopRun = useCanvasChatStore((s) => s.stopRun);
  const setRunActive = useCanvasChatStore((s) => s.setRunActive);
  // Org context for Stop — needed by the abort endpoint.
  const orgContext = useCanvasChatStore((s) => (activeId ? s.conversations[activeId]?.context : null) ?? null);
  const { id: workspaceId } = useWorkspace();
  const { isActive } = useCanvasAgentActivity(activeId, workspaceId);
  const [isForking, setIsForking] = useState(false);

  const handleShare = async () => {
    if (!serverConversationId) return;
    try {
      // Every org-canvas row is already a joinable room (`isShared`
      // defaults true) and the URL tracks the live row, so sharing is
      // just copying the `?chat=<id>` link — no flag to flip, no
      // snapshot, no fork. Anyone in the org who opens it adopts the same
      // row and live-sync keeps everyone in step.
      const url = `${window.location.origin}/org/${githubLogin}?chat=${serverConversationId}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied to clipboard!");
    } catch (error) {
      console.error("Error sharing conversation:", error);
      toast.error("Failed to copy share link", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleFork = async () => {
    if (!serverConversationId || isStreaming || isForking) return;
    setIsForking(true);
    try {
      const forkId = await forkCanvasConversation(githubLogin, serverConversationId);
      // Swap the URL to the fork without a Next.js navigation / RSC refetch —
      // same pattern as handleClear (strip ?chat=) and useSendCanvasChatMessage
      // (set ?chat=).
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        params.set("chat", forkId);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      }
      toast.success("Chat forked — you're now in your own copy.");
    } catch (error) {
      console.error("Error forking conversation:", error);
      toast.error("Failed to fork chat", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsForking(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {isActive && (
        <span
          className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
          aria-label="agent active"
        />
      )}
      {runActive && (
        <button
          type="button"
          onClick={() => {
            if (serverConversationId && orgContext) {
              void stopRun({
                serverConversationId,
                orgId: orgContext.orgId,
              });
              // Optimistic local clear — the Pusher event will confirm.
              if (activeId) setRunActive(activeId, false);
            }
          }}
          title="Stop investigation"
          className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium transition-colors"
        >
          <OctagonX className="w-3.5 h-3.5" />
          Stop
        </button>
      )}
      <ActionTip label="Copy share link">
        <button
          type="button"
          onClick={handleShare}
          disabled={!serverConversationId}
          aria-label="Copy share link"
          className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </ActionTip>
      <ActionTip label="Fork chat">
        <button
          type="button"
          onClick={handleFork}
          disabled={!serverConversationId || isStreaming || isForking}
          aria-label="Fork chat"
          className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Split className="w-4 h-4" />
        </button>
      </ActionTip>
      <CanvasAgentSettingsPopover githubLogin={githubLogin} />
      {!hideHistory && <CanvasHistoryPopover githubLogin={githubLogin} />}
      <ActionTip label="New chat">
        <button
          type="button"
          onClick={() => startNewOrgConversation(githubLogin)}
          disabled={!hasMessages}
          aria-label="New chat"
          className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </ActionTip>
    </div>
  );
}

/**
 * Stable empty-array references so the selectors above return the
 * same reference when the active conversation is missing — Zustand's
 * `Object.is` bail-out skips re-renders on identity equality.
 */
const EMPTY_MESSAGES: CanvasChatMessage[] = [];
const EMPTY_TOOL_CALLS: ToolCall[] = [];

/**
 * Dispatch point for rich agent artifacts. Selects `state.artifacts`
 * by id (via `useShallow` so streaming text-deltas don't re-render
 * here) and switches on `artifact.type`.
 *
 * Future canvas-bound types (proposals' canvas halos, sub-agent
 * status pills, etc.) layer in additional cases here.
 */
function MessageArtifacts({ artifactIds }: { artifactIds?: string[] }) {
  const ids = artifactIds ?? EMPTY_ARTIFACT_IDS;
  // Filter dismissed ids inside the selector so neither the artifact
  // map mutation nor the dismiss-set mutation alone causes a useless
  // re-render — only when the *visible* set changes do we rebuild.
  const artifacts = useCanvasChatStore(
    useShallow((s) =>
      ids
        .filter((id) => !s.dismissedArtifactIds[id])
        .map((id) => s.artifacts[id])
        .filter(Boolean),
    ),
  );
  if (ids.length === 0 || artifacts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {artifacts.map((artifact) => {
        // Unknown artifact type — render nothing rather than crash.
        void artifact;
        return null;
      })}
    </div>
  );
}

const EMPTY_ARTIFACT_IDS: string[] = [];

// ─── File attachment types ───────────────────────────────────────────────────

interface PendingFile {
  id: string;
  file: File;
  /** Object URL — revoke on remove/send to free memory. */
  preview: string;
  uploading: boolean;
  error?: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Set once upload completes; undefined while in-flight or errored. */
  s3Path?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** What the chat surface can ask of its composer. */
interface SidebarChatInputHandle {
  /** Queue files as pending attachments — how a drop anywhere on the chat gets in. */
  addFiles: (files: FileList | File[]) => void;
}

interface SidebarChatInputProps {
  onSend: (message: string, attachments: CanvasAttachment[], clearInput: () => void) => Promise<void>;
  disabled?: boolean;
  /** Workspace id for the S3 upload context. */
  workspaceId: string;
  /** Fallback org id when workspaceId is absent (org canvas context). */
  orgId?: string;
}

/**
 * The chat's composer: one rounded shell holding an auto-growing textarea
 * (CSS field-sizing-content) with attach, voice and send sitting at its
 * end, so the buttons never overlap the text. Enter sends, Shift+Enter
 * adds a line. Files arrive through the paperclip, the clipboard, or a
 * drop anywhere on the chat (the parent owns the drop zone and hands them
 * in through `addFiles`). Intentionally separate from
 * `DashboardChat/ChatInput` — the prop surface diverges enough that
 * sharing would require ugly conditionals (workspace pills, etc.).
 */
const SidebarChatInput = forwardRef<SidebarChatInputHandle, SidebarChatInputProps>(function SidebarChatInput(
  { onSend, disabled = false, workspaceId, orgId },
  ref,
) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Grow with the content; the class list's `max-h` caps it and it
  // scrolls from there. `field-sizing: content` covers Chromium; this
  // covers every other browser and keeps the two in agreement. An empty
  // box is left to CSS: measuring it while it is narrow or not laid out
  // (its placeholder wrapped, or no width at all) would lock in a tall
  // height that nothing resets until the next keystroke.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!input || el.clientWidth === 0) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Derived — no extra state needed
  const isUploading = pendingFiles.some((f) => f.uploading);

  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const preVoiceInputRef = useRef("");
  const { nudgeIfNeeded } = useVoiceLearningPreference();
  const { capture } = useVoiceCorrectionCapture({
    surface: "sidebar",
    workspaceId: workspaceId || undefined, // empty string → absent
    orgGithubLogin: orgId, // orgId prop is already githubLogin
  });

  // Append transcript to existing input (do not overwrite)
  useEffect(() => {
    if (transcript) {
      const newValue = preVoiceInputRef.current ? `${preVoiceInputRef.current} ${transcript}`.trim() : transcript;
      setInput(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      nudgeIfNeeded();
      preVoiceInputRef.current = input;
      startListening();
    }
  }, [isListening, stopListening, startListening, input, nudgeIfNeeded]);

  useControlKeyHold({
    onStart: () => {
      nudgeIfNeeded();
      preVoiceInputRef.current = input;
      startListening();
    },
    onStop: stopListening,
    enabled: isSupported && !disabled,
  });

  // ─── Pending-draft consumption ─────────────────────────────────────
  const pendingDraft = useCanvasChatStore((s) => s.pendingInputDraft);
  useEffect(() => {
    if (pendingDraft === null) return;
    // An empty draft only asks for focus; the text already there stays.
    if (pendingDraft) setInput(pendingDraft);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    useCanvasChatStore.getState().setPendingInputDraft(null);
  }, [pendingDraft]);

  // ─── Unmount cleanup — revoke all preview object URLs ──────────────
  useEffect(() => {
    return () => {
      setPendingFiles((prev) => {
        prev.forEach((f) => URL.revokeObjectURL(f.preview));
        return [];
      });
    };
  }, []);

  // ─── File upload helpers ────────────────────────────────────────────

  const uploadFile = useCallback(
    async (pf: PendingFile) => {
      setPendingFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, uploading: true, error: undefined } : f)));
      try {
        const uploadContext = workspaceId ? { workspaceId } : { orgId: orgId! };
        const result = await uploadFileToS3(pf.file, uploadContext);
        setPendingFiles((prev) =>
          prev.map((f) => (f.id === pf.id ? { ...f, uploading: false, s3Path: result.path } : f)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setPendingFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, uploading: false, error: msg } : f)));
        toast.error(`Failed to upload ${pf.filename}`, { description: msg });
      }
    },
    [workspaceId, orgId],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      const newFiles: PendingFile[] = [];
      for (const file of arr) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds 10 MB`);
          continue;
        }
        newFiles.push({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          uploading: false,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        });
      }
      if (!newFiles.length) return;
      setPendingFiles((prev) => [...prev, ...newFiles]);
      newFiles.forEach((pf) => uploadFile(pf));
    },
    [uploadFile],
  );

  useImperativeHandle(ref, () => ({ addFiles: handleFiles }), [handleFiles]);

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const f = prev.find((f) => f.id === id);
      if (f) URL.revokeObjectURL(f.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // ─── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    if (pendingFiles.some((f) => f.uploading)) {
      toast.error("Please wait for uploads to finish");
      return;
    }
    if (pendingFiles.some((f) => f.error)) {
      toast.error("Remove failed uploads before sending");
      return;
    }

    const message = input.trim();
    capture({
      rawTranscript: transcript,
      preVoiceText: preVoiceInputRef.current,
      finalText: message,
    });
    if (isListening) stopListening();
    resetTranscript();
    preVoiceInputRef.current = "";

    const attachments: CanvasAttachment[] = pendingFiles
      .filter((f) => f.s3Path)
      .map((f) => ({
        path: f.s3Path!,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
      }));

    // Revoke preview URLs and clear pending files
    pendingFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setPendingFiles([]);
    setInput(""); // clear immediately on send

    await onSend(message, attachments, () => {
      inputRef.current?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((i) => i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter(Boolean) as File[];
    if (imageFiles.length) {
      e.preventDefault();
      handleFiles(imageFiles);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── Pending file chips ─────────────────────────────────────────── */}
      {pendingFiles.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 px-1 pb-1.5" data-testid="pending-files-grid">
          {pendingFiles.map((pf) => (
            <div
              key={pf.id}
              className={cn("relative rounded-lg border overflow-hidden bg-muted", pf.error && "border-red-500")}
              data-testid={`pending-file-${pf.id}`}
            >
              <div className="aspect-square relative">
                {pf.mimeType.startsWith("image/") ? (
                  <img src={pf.preview} alt={pf.filename} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                {pf.uploading && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" data-testid={`uploading-spinner-${pf.id}`} />
                  </div>
                )}
                {pf.error && (
                  <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-1 p-1">
                    <p className="text-xs text-red-500 text-center">Failed</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-1.5 text-xs"
                      onClick={() => uploadFile(pf)}
                    >
                      <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                      Retry
                    </Button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(pf.id)}
                  data-testid={`remove-file-${pf.id}`}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-background/80 hover:bg-background"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
              <div className="px-1 py-0.5 text-[10px] truncate text-center text-muted-foreground">{pf.filename}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Composer ──────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-1 rounded-2xl border bg-background px-1.5 py-1.5 transition-[border-color,box-shadow,opacity]",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10",
          disabled && "opacity-70",
        )}
      >
        <div className="min-w-0 flex-1">
          <Textarea
            ref={inputRef}
            placeholder={isListening ? "Listening…" : `Message ${jamieName}`}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            isUploading={isUploading}
            rows={1}
            className="field-sizing-content max-h-[200px] min-h-0 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:border-0 focus-visible:ring-0 disabled:cursor-not-allowed md:text-sm dark:bg-transparent"
          />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ActionTip label="Attach file" side="top">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Attach file"
              data-testid="paperclip-button"
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
          </ActionTip>
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            multiple
            className="hidden"
            data-testid="file-input"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {isSupported && (
            <ActionTip label={isListening ? "Stop recording" : "Voice input (or hold Ctrl)"} side="top">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={toggleListening}
                disabled={disabled}
                aria-label={isListening ? "Stop recording" : "Voice input"}
                data-testid="mic-button"
                className={cn(
                  "h-7 w-7 rounded-full",
                  isListening
                    ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </Button>
            </ActionTip>
          )}
          <ActionTip label="Send" side="top">
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={!input.trim() || disabled || isUploading}
              className="h-7 w-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/60 disabled:opacity-100"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </ActionTip>
        </div>
      </form>
    </div>
  );
});
