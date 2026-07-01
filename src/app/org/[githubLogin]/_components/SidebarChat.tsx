"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { FileIcon, Loader2, Mic, MicOff, Paperclip, Plus, RefreshCw, Send, Share2, X } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { useVoiceCorrectionCapture } from "@/hooks/useVoiceCorrectionCapture";
import { useVoiceLearningPreference } from "@/hooks/useVoiceLearningPreference";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";
import {
  SubAgentRunCard,
  getSubAgentRunsFromMessages,
} from "./SubAgentRunCard";
import {
  ResearchRunCard,
  getResearchRunsFromMessages,
} from "./ResearchRunCard";
import { PlannerFormSlot } from "./PlannerFormSlot";
import { StartTasksSlot } from "./StartTasksSlot";
import { MyActivityPanel } from "./MyActivityPanel";
import { DeferredCheckCard } from "./DeferredCheckCard";
import { DailyRecapCard } from "@/components/daily-recap/DailyRecapCard";
import type { ActivityItem } from "@/app/api/profile/activity/route";
import {
  useCanvasChatStore,
  timelineFromToolCalls,
  type CanvasAttachment,
  type CanvasChatMessage,
  type ToolCall,
} from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";
import { useAutomationInbox } from "../_state/useAutomationInbox";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCanvasAgentActivity } from "@/hooks/useCanvasAgentActivity";
import { uploadFileToS3 } from "@/lib/upload-image-to-s3";
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
interface SidebarChatProps {
  /** Slug of the org. Used by the Share button to scope the POST. */
  githubLogin: string;
}

export function SidebarChat({ githubLogin }: SidebarChatProps) {
  // Auto-open the most recent unseen automation run, if any, once on load.
  useAutomationInbox(githubLogin);

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
  const isLoading = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.isLoading : false) ?? false,
  );
  const activeToolCalls = useCanvasChatStore(
    (s) =>
      (activeId ? s.conversations[activeId]?.activeToolCalls : undefined) ??
      EMPTY_TOOL_CALLS,
  );
  // The persisted row id. Sharing flips this row to `isShared` and hands
  // out its id, so the sharer and every joiner live in the *same* room.
  // Null until autosave has created the row — Share is gated on it.
  const serverConversationId = useCanvasChatStore(
    (s) =>
      (activeId ? s.conversations[activeId]?.serverConversationId : null) ??
      null,
  );

  const senderProfiles = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.senderProfiles : undefined) ?? EMPTY_SENDER_PROFILES,
  );

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const { id: workspaceId } = useWorkspace();
  const { isActive } = useCanvasAgentActivity(activeId, workspaceId);

  const sendMessage = useSendCanvasChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isProgrammaticScrollRef = useRef(false);

  // Scroll to bottom on updates unless the user has manually scrolled up.
  useEffect(() => {
    if (!userScrolledUp) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeToolCalls, isLoading, userScrolledUp]);

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

  const handleSend = async (
    content: string,
    attachments: CanvasAttachment[],
    clearInput: () => void,
  ) => {
    if (!activeId) return;
    await sendMessage({
      conversationId: activeId,
      content,
      attachments,
      onResponseStart: () => clearInput(),
    });
  };

  const handleClear = () => {
    // Start a brand-new conversation in its own slot rather than wiping
    // the active one in place. An in-flight stream stays bound to its
    // original slot (closed over in `useSendCanvasChatMessage`), so it
    // can't bleed into this fresh chat. The new chat inherits the current
    // canvas scope (context) so its first turn targets the right canvas.
    const store = useCanvasChatStore.getState();
    const activeId = store.activeConversationId;
    const context = activeId
      ? store.conversations[activeId]?.context
      : undefined;
    store.startConversation(
      context ?? {
        orgId: "",
        githubLogin: githubLogin ?? "",
        workspaceSlug: null,
        workspaceSlugs: [],
        currentCanvasRef: "",
        currentCanvasBreadcrumb: "",
        selectedNodeId: null,
        selectedNodeIds: [],
      },
      [],
      undefined,
      0,
    );
    // Drop the stale `?chat=<id>` deep link so a reload/preload doesn't
    // re-adopt the conversation we just left. `history.replaceState`
    // (NOT `router.replace`) to avoid a Next navigation / RSC refetch on
    // this `protected` route — same reasoning as `setUrlSlug` (`?c=`) and
    // `setUrlResearchSlug` (`?r=`) in OrgCanvasView, and the `?chat=`
    // writer in useSendCanvasChatMessage.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.delete("chat");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
    }
  };

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
          {!run.pendingForm &&
            run.messages.some((m) => m.direction === "in") && (
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
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Ask Jamie</span>
          {isActive && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
              aria-label="agent active"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleShare}
            disabled={!serverConversationId}
            title="Copy share link"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <CanvasAgentSettingsPopover githubLogin={githubLogin} />
          <CanvasHistoryPopover githubLogin={githubLogin} />
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasMessages}
            title="New chat"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto h-full px-4 py-3">
        {!hasMessages && activeToolCalls.length === 0 && (
          <div className="h-full flex items-center justify-center px-4 text-center text-muted-foreground text-sm">
            Ask the agent about anything on this canvas.
          </div>
        )}
        <div className="space-y-2">
          <DailyRecapCard />
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            const isMessageStreaming = isLastMessage && isLoading;

            // User messages that ride structured Approve / Reject
            // intents are not chat content for the user — the proposal
            // card transition is the visual feedback. Suppress the
            // bubble entirely; the message stays in the JSON for the
            // route handler to detect on subsequent clicks and for
            // status derivation across forks.
            if (
              message.role === "user" &&
              (message.approval || message.rejection)
            ) {
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

            if (
              message.source?.kind === "planner" ||
              message.source?.kind === "user-answered-planner-form" ||
              message.source?.kind === "research"
            ) {
              if (
                (!subAgentRuns || subAgentRuns.length === 0) &&
                (!researchRuns || researchRuns.length === 0)
              )
                return null;
              return (
                <div key={message.id} className="space-y-1.5">
                  {subAgentRuns && renderSubAgentRuns(subAgentRuns)}
                  {researchRuns?.map((run) => (
                    <ResearchRunCard
                      key={run.researchId}
                      run={run}
                      githubLogin={githubLogin}
                    />
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
              message.timeline ??
              (message.toolCalls?.length
                ? timelineFromToolCalls(message.toolCalls)
                : undefined);

            const filteredTimeline =
              proposalToolCallIds.size > 0
                ? effectiveTimeline?.filter(
                    (item) =>
                      item.type !== "toolCall" ||
                      !proposalToolCallIds.has(item.id),
                  )
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
                      }}
                    />
                  </div>
                ) : (
                  <SidebarChatMessage
                    message={message}
                    isStreaming={isMessageStreaming}
                    currentUserId={currentUserId}
                    senderProfile={
                      message.senderId
                        ? senderProfiles[message.senderId]
                        : undefined
                    }
                  />
                )}
                {proposals.length > 0 && (
                  <div className="space-y-1.5">
                    {sortProposalsByDependency(proposals).map((p) => (
                      <ProposalCard
                        key={p.proposalId}
                        proposal={p}
                        messageId={message.id}
                        githubLogin={githubLogin}
                      />
                    ))}
                  </div>
                )}
                {message.deferredCheck && (
                  <DeferredCheckCard
                    deferredCheck={message.deferredCheck}
                    githubLogin={githubLogin}
                  />
                )}
                {subAgentRuns &&
                  subAgentRuns.length > 0 &&
                  renderSubAgentRuns(subAgentRuns)}
                {researchRuns &&
                  researchRuns.length > 0 &&
                  researchRuns.map((run) => (
                    <ResearchRunCard
                      key={run.researchId}
                      run={run}
                      githubLogin={githubLogin}
                    />
                  ))}
                <MessageArtifacts artifactIds={message.artifactIds} />
              </div>
            );
          })}
          {isLoading && activeToolCalls.length === 0 && (
            <motion.div
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
                  >.</motion.span>
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                    className="text-sm text-foreground/60"
                  >.</motion.span>
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                    className="text-sm text-foreground/60"
                  >.</motion.span>
                </div>
              </div>
            </motion.div>
          )}
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
      </div>  {/* end relative wrapper */}

      <div className="border-t p-2">
        <SidebarChatInput
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
 * Stable empty-array references so the selectors above return the
 * same reference when the active conversation is missing — Zustand's
 * `Object.is` bail-out skips re-renders on identity equality.
 */
const EMPTY_MESSAGES: CanvasChatMessage[] = [];
const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_SENDER_PROFILES: Record<string, { username: string; avatarUrl?: string }> = {};

/**
 * Dispatch point for rich agent artifacts. Selects `state.artifacts`
 * by id (via `useShallow` so streaming text-deltas don't re-render
 * here) and switches on `artifact.type`.
 *
 * Currently registered types:
 *   - `my-activity` — compact "My Activity" intro card showing the user's
 *     recent tasks, chats, plans, and milestones. Seeded by `OrgCanvasView`
 *     on fresh canvas entry; data shape is `ActivityItem[]` from
 *     `services/roadmap/user-activity.ts`.
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
  const dismissArtifact = useCanvasChatStore((s) => s.dismissArtifact);
  if (ids.length === 0 || artifacts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {artifacts.map((artifact) => {
        if (artifact.type === "my-activity") {
          const data = artifact.data as { items: ActivityItem[] } | undefined;
          if (!data || !Array.isArray(data.items)) return null;
          return (
            <MyActivityPanel
              key={artifact.id}
              initialItems={data.items}
              onDismiss={() => dismissArtifact(artifact.id)}
            />
          );
        }
        // Unknown artifact type — render nothing rather than crash.
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

interface SidebarChatInputProps {
  onSend: (
    message: string,
    attachments: CanvasAttachment[],
    clearInput: () => void,
  ) => Promise<void>;
  disabled?: boolean;
  /** Workspace id for the S3 upload context. */
  workspaceId: string;
  /** Fallback org id when workspaceId is absent (org canvas context). */
  orgId?: string;
}

/**
 * Minimal chat input for the sidebar. Auto-growing textarea (CSS
 * field-sizing-content), Enter-to-send, Shift+Enter for newline.
 * Supports file attachments via paperclip button, drag-and-drop,
 * and clipboard paste. Intentionally separate from
 * `DashboardChat/ChatInput` — the prop surface diverges enough that
 * sharing would require ugly conditionals (workspace pills, etc.).
 */
function SidebarChatInput({
  onSend,
  disabled = false,
  workspaceId,
  orgId,
}: SidebarChatInputProps) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived — no extra state needed
  const isUploading = pendingFiles.some((f) => f.uploading);

  const {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const preVoiceInputRef = useRef("");
  const { nudgeIfNeeded } = useVoiceLearningPreference();
  const { capture } = useVoiceCorrectionCapture({
    surface: "sidebar",
    workspaceId: workspaceId || undefined, // empty string → absent
    orgGithubLogin: orgId,                 // orgId prop is already githubLogin
  });

  // Append transcript to existing input (do not overwrite)
  useEffect(() => {
    if (transcript) {
      const newValue = preVoiceInputRef.current
        ? `${preVoiceInputRef.current} ${transcript}`.trim()
        : transcript;
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
    setInput(pendingDraft);
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
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pf.id ? { ...f, uploading: true, error: undefined } : f,
        ),
      );
      try {
        const uploadContext = workspaceId ? { workspaceId } : { orgId: orgId! };
        const result = await uploadFileToS3(pf.file, uploadContext);
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id
              ? { ...f, uploading: false, s3Path: result.path }
              : f,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id ? { ...f, uploading: false, error: msg } : f,
          ),
        );
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

  // ─── Drag-and-drop ──────────────────────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  // Button column count: send is always present, mic is conditional, paperclip is always present
  // right-1.5 = send, right-9 = mic (when supported), right-[3.75rem] = paperclip (when mic present), right-9 = paperclip (when no mic)
  const sendRight = "right-1.5";
  const micRight = "right-9";
  const paperclipRight = isSupported ? "right-[3.75rem]" : "right-9";
  const textareaPaddingRight = isSupported
    ? "pr-[calc(theme(space.7)*3+theme(space.5))]"
    : "pr-[calc(theme(space.7)*2+theme(space.5))]";

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── Pending file chips ─────────────────────────────────────────── */}
      {pendingFiles.length > 0 && (
        <div
          className="grid grid-cols-3 gap-1.5 px-1 pb-1.5"
          data-testid="pending-files-grid"
        >
          {pendingFiles.map((pf) => (
            <div
              key={pf.id}
              className={cn(
                "relative rounded-lg border overflow-hidden bg-muted",
                pf.error && "border-red-500",
              )}
              data-testid={`pending-file-${pf.id}`}
            >
              <div className="aspect-square relative">
                {pf.mimeType.startsWith("image/") ? (
                  <img
                    src={pf.preview}
                    alt={pf.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                {pf.uploading && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Loader2
                      className="h-5 w-5 animate-spin text-primary"
                      data-testid={`uploading-spinner-${pf.id}`}
                    />
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
              <div className="px-1 py-0.5 text-[10px] truncate text-center text-muted-foreground">
                {pf.filename}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Input form ─────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative flex-1 min-w-0">
          <Textarea
            ref={inputRef}
            placeholder={isListening ? "Listening…" : "Ask the agent…"}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            isDragging={isDragging}
            isUploading={isUploading}
            rows={1}
            className={`w-full px-3 py-2 ${textareaPaddingRight} rounded-xl bg-background border border-muted-foreground/70 text-sm text-foreground/95 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-[color,border-color,box-shadow,opacity] resize-none field-sizing-content max-h-[100px] overflow-y-auto min-h-0 ${
              disabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          />

          {/* Paperclip button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  data-testid="paperclip-button"
                  className={`absolute ${paperclipRight} top-1/2 -translate-y-[60%] h-7 w-7 rounded-full text-muted-foreground hover:text-foreground`}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Attach file</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Hidden file input */}
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

          {/* Mic button */}
          {isSupported && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={toggleListening}
                    disabled={disabled}
                    data-testid="mic-button"
                    className={`absolute ${micRight} top-1/2 -translate-y-[60%] h-7 w-7 rounded-full ${
                      isListening
                        ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isListening ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isListening
                    ? "Stop recording"
                    : "Start voice input (or hold Ctrl)"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Send button */}
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || disabled || isUploading}
            className={`absolute ${sendRight} top-1/2 -translate-y-[60%] h-7 w-7 rounded-full`}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </form>
    </div>
  );
}
