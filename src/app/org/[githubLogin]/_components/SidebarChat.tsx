"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ToolCallIndicator } from "@/components/dashboard/DashboardChat/ToolCallIndicator";
import { Button } from "@/components/ui/button";
import { SidebarChatMessage } from "./SidebarChatMessage";
import { ProposalCard, getProposalsFromMessage } from "./ProposalCard";
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

  const sendMessage = useSendCanvasChatMessage();
  const inputClearRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the messages container (not the page) to the bottom on
  // updates. `scrollTop = scrollHeight` instead of `scrollIntoView`
  // so the page never gets dragged when a streaming delta lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeToolCalls]);

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!activeId) return;
    inputClearRef.current = clearInput;
    await sendMessage({
      conversationId: activeId,
      content,
      onResponseStart: () => clearInput(),
    });
  };

  const handleClear = () => {
    useCanvasChatStore.getState().clearActiveConversation();
  };

  const handleShare = async () => {
    if (!activeId) return;
    if (messages.length === 0) return;
    try {
      const firstUserMessage = messages.find(
        (m) => m.role === "user" && m.content.trim(),
      );
      const title = firstUserMessage
        ? firstUserMessage.content.slice(0, 50) +
          (firstUserMessage.content.length > 50 ? "..." : "")
        : "Shared Conversation";

      const res = await fetch(`/api/org/${githubLogin}/chat/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          title,
          // The endpoint requires this field; we have nothing to
          // share. `[]` is truthy in JS so the falsy guard accepts it.
          followUpQuestions: [],
          source: "org-canvas",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to share conversation");
      }
      const data = await res.json();
      // Use the forking URL shape `?chat=<shareId>` rather than the
      // standalone read-only viewer at `/chat/shared/<shareId>` that
      // the server returns. The viewer page still works for anyone
      // who lands on it directly.
      const url = `${window.location.origin}/org/${githubLogin}?chat=${data.shareId}`;
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

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium text-muted-foreground">Agent</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleShare}
            disabled={!hasMessages}
            title="Copy share link"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
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

            const proposals = getProposalsFromMessage(message);

            return (
              <div key={message.id} className="space-y-1.5">
                <SidebarChatMessage
                  message={message}
                  isStreaming={isMessageStreaming}
                />
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
                <MessageArtifacts artifactIds={message.artifactIds} />
              </div>
            );
          })}
          {activeToolCalls.length > 0 && (
            <ToolCallIndicator toolCalls={activeToolCalls} />
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
const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20; // matches text-sm line-height
const MAX_HEIGHT_PX = MAX_ROWS * LINE_HEIGHT_PX;

function SidebarChatInput({ onSend, disabled = false }: SidebarChatInputProps) {
  const [input, setInput] = useState("");
  const [height, setHeight] = useState<string>("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        el.style.height = "auto";
        const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
        setHeight(`${newHeight}px`);
      }
    });
    useCanvasChatStore.getState().setPendingInputDraft(null);
  }, [pendingDraft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    await onSend(message, () => {
      setInput("");
      setHeight("auto");
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
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    setHeight(`${newHeight}px`);
  };

  const overflowY =
    height !== "auto" && parseInt(height) >= MAX_HEIGHT_PX ? "auto" : "hidden";

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1 min-w-0">
        <textarea
          ref={inputRef}
          placeholder="Ask the agent…"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          style={{ height, overflowY }}
          className={`w-full px-3 py-2 pr-10 rounded-xl bg-background border border-border/50 text-sm text-foreground/95 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        />
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
