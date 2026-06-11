"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Send, Share2, X } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
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
import { SidebarChatMessage } from "./SidebarChatMessage";
import { ProposalCard, getProposalsFromMessage } from "./ProposalCard";
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
import { AttentionList } from "./AttentionList";
import type { AttentionItem } from "@/services/attention/topItems";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
  type ToolCall,
} from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";

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

  const sendMessage = useSendCanvasChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the messages container (not the page) to the bottom on
  // updates. `scrollTop = scrollHeight` instead of `scrollIntoView`
  // so the page never gets dragged when a streaming delta lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeToolCalls, isLoading]);

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!activeId) return;
    await sendMessage({
      conversationId: activeId,
      content,
      onResponseStart: () => clearInput(), // now only re-focuses, harmless to keep
    });
  };

  const handleClear = () => {
    useCanvasChatStore.getState().clearActiveConversation();
  };

  const handleShare = async () => {
    if (!serverConversationId) return;
    try {
      // Mark the LIVE conversation row as a shared room and hand out its
      // id. No snapshot/fork: the sharer is already on this row, and
      // anyone who opens `?chat=<id>` adopts the same row, so everyone
      // appends to one conversation and live-sync keeps them in step.
      const res = await fetch(
        `/api/orgs/${githubLogin}/chat/conversations/${serverConversationId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Empty delta — this PUT only flips the `isShared` flag.
          body: JSON.stringify({ messages: [], isShared: true }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to share conversation");
      }
      const url = `${window.location.origin}/org/${githubLogin}?chat=${serverConversationId}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied to clipboard!");
    } catch (error) {
      console.error("Error sharing conversation:", error);
      toast.error("Failed to share conversation", {
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
        <span className="text-xs font-medium text-muted-foreground">Agent</span>
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
          <CanvasAgentSettingsPopover />
          <CanvasHistoryPopover githubLogin={githubLogin} />
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasMessages}
            title="Clear conversation"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {!hasMessages && activeToolCalls.length === 0 && (
          <div className="h-full flex items-center justify-center px-4 text-center text-muted-foreground text-sm">
            Ask the agent about anything on this canvas.
          </div>
        )}
        <div className="space-y-2">
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

            // A streamed tool-call row carries a `timeline` (and empty
            // text content). Render it as rich, expandable tool cards via
            // the shared `<StreamingMessage>` — names, args, outputs, and
            // live status, in order with any interleaved text. Plain text
            // rows fall through to `SidebarChatMessage` so the bubble look
            // and the `?r=`/`?c=` deep-link interceptor are preserved.
            const hasTimeline = !!message.timeline?.length;

            return (
              <div key={message.id} className="space-y-1.5">
                {hasTimeline ? (
                  <div className="w-full text-foreground/90">
                    <StreamingMessage
                      message={{
                        id: message.id,
                        content: message.content,
                        timeline: message.timeline,
                        isStreaming: isMessageStreaming,
                      }}
                    />
                  </div>
                ) : (
                  <SidebarChatMessage
                    message={message}
                    isStreaming={isMessageStreaming}
                  />
                )}
                {proposals.length > 0 && (
                  <div className="space-y-1.5">
                    {proposals.map((p) => (
                      <ProposalCard
                        key={p.proposalId}
                        proposal={p}
                        messageId={message.id}
                        githubLogin={githubLogin}
                      />
                    ))}
                  </div>
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
        </div>
      </div>

      <div className="border-t p-2">
        <SidebarChatInput onSend={handleSend} disabled={isLoading} />
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

/**
 * Dispatch point for rich agent artifacts. Selects `state.artifacts`
 * by id (via `useShallow` so streaming text-deltas don't re-render
 * here) and switches on `artifact.type`.
 *
 * Currently registered types:
 *   - `attention-list` — synthetic intro card listing items needing
 *     the user's attention. Seeded by `OrgCanvasView` on fresh
 *     canvas entry; data shape is `AttentionItem[]` from
 *     `services/attention/topItems.ts`.
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
        if (artifact.type === "attention-list") {
          const data = artifact.data as
            | { items: AttentionItem[]; total: number }
            | undefined;
          if (!data || !Array.isArray(data.items)) return null;
          return (
            <AttentionList
              key={artifact.id}
              items={data.items}
              total={data.total}
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

interface SidebarChatInputProps {
  onSend: (message: string, clearInput: () => void) => Promise<void>;
  disabled?: boolean;
}

/**
 * Minimal chat input for the sidebar. Auto-growing textarea (1–6
 * rows), Enter-to-send, Shift+Enter for newline. Intentionally
 * separate from `DashboardChat/ChatInput` — the prop surface
 * diverges far enough that sharing would require ugly conditionals
 * (no image upload, no workspace pills, no `+ workspace` button).
 */
function SidebarChatInput({ onSend, disabled = false }: SidebarChatInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const preVoiceInputRef = useRef("");

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
      preVoiceInputRef.current = input;
      startListening();
    }
  }, [isListening, stopListening, startListening, input]);

  useControlKeyHold({
    onStart: () => {
      preVoiceInputRef.current = input;
      startListening();
    },
    onStop: stopListening,
    enabled: isSupported && !disabled,
  });

  // ─── Pending-draft consumption ─────────────────────────────────────
  // Canvas affordances (e.g. the "+ Create connection" button on a
  // selected edge) compose a message FOR the user by writing to
  // `pendingInputDraft` in the store. We adopt the value once and
  // immediately clear it so a tab-switch back to chat doesn't
  // re-apply a stale draft. The textarea height is recomputed from
  // the new content so multi-line drafts don't render as a single
  // truncated row.
  const pendingDraft = useCanvasChatStore((s) => s.pendingInputDraft);
  useEffect(() => {
    if (pendingDraft === null) return;
    setInput(pendingDraft);
    // Defer the focus + height-fit to the next frame so the textarea
    // has the new value committed before we measure scrollHeight.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        // Move the caret to the end so the user can append context.
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    useCanvasChatStore.getState().setPendingInputDraft(null);
  }, [pendingDraft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    if (isListening) {
      stopListening();
    }
    resetTranscript();
    preVoiceInputRef.current = "";
    setInput(""); // clear immediately on send
    await onSend(message, () => {
      inputRef.current?.focus(); // callback now only handles re-focus
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

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1 min-w-0">
        <textarea
          ref={inputRef}
          placeholder={isListening ? "Listening…" : "Ask the agent…"}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          className={`w-full px-3 py-2 ${isSupported ? "pr-16" : "pr-10"} rounded-xl bg-background border border-muted-foreground/70 text-sm text-foreground/95 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-[color,border-color,box-shadow,opacity] resize-none field-sizing-content max-h-[100px] overflow-y-auto ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        />
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
                  className={`absolute right-9 top-1/2 -translate-y-[60%] h-7 w-7 rounded-full ${
                    isListening
                      ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isListening ? "Stop recording" : "Start voice input (or hold Ctrl)"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || disabled}
          className="absolute right-1.5 top-1/2 -translate-y-[60%] h-7 w-7 rounded-full"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </form>
  );
}
