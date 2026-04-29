"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowUpRight, Loader2, Send } from "lucide-react";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
} from "@/lib/chat";
import { isClarifyingQuestions } from "@/types/stakwork";
import { usePusherConnection } from "@/hooks/usePusherConnection";
import { getPusherClient } from "@/lib/pusher";
import { Button } from "@/components/ui/button";
import { FeaturePlanChatMessage } from "./FeaturePlanChatMessage";

/**
 * Compact, sidebar-shaped feature-plan chat for the org canvas.
 *
 * Mounted inside `NodeDetail`'s `case "feature"` arm so the user can
 * read and continue a feature's planning conversation without
 * navigating away from the canvas. Reads/writes the same API the
 * full plan page uses (`/api/features/[featureId]/chat`) and
 * subscribes to the same Pusher channel for live updates — so a
 * message sent from the canvas appears on the full plan page in real
 * time, and vice versa.
 *
 * What this surface deliberately omits compared to `PlanChatView`:
 *
 *   - No artifacts panel (PLAN/TASKS/VERIFY tabs). Use the
 *     "Full plan view" link to open `/w/{slug}/plan/{featureId}`.
 *   - No collaborator presence / typing indicators.
 *   - No project-log streaming.
 *   - No model picker — sends use the persisted `feature.model`.
 *   - No file/image attachments.
 *   - No title editing, no breadcrumbs, no mobile preview swap.
 *
 * The one artifact type that IS rendered: clarifying-question cards
 * (`PLAN` artifact whose `content.tool_use === "ask_clarifying_questions"`).
 * Without this, the agent's planning workflow visibly stalls on the
 * canvas whenever it needs structured input — see
 * `FeaturePlanChatMessage` for the renderer.
 */
interface FeaturePlanChatProps {
  /** Prisma `Feature.id`. Drives the chat fetch + Pusher channel. */
  featureId: string;
  /** Workspace slug the feature belongs to. Used by the "Full plan view" link. */
  workspaceSlug: string;
  /**
   * Live workflow status from the canvas node API
   * (`extras.workflowStatus`). Used to seed initial state without a
   * second `/api/features/[id]` round-trip; Pusher takes over after
   * mount.
   */
  initialWorkflowStatus?: WorkflowStatus | null;
}

function generateUniqueId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function FeaturePlanChat({
  featureId,
  workspaceSlug,
  initialWorkflowStatus = null,
}: FeaturePlanChatProps) {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(
    initialWorkflowStatus,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Initial fetch ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/features/${featureId}/chat`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => {
        if (cancelled) return;
        setMessages((body?.data ?? []) as ChatMessage[]);
      })
      .catch(() => {
        // Fall through to empty conversation; the user can still try
        // to send a message and surface a real error.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [featureId]);

  // ─── Pusher subscription ──────────────────────────────────────────
  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
    setSending(false);
  }, []);

  const handleWorkflowStatusUpdate = useCallback(
    (update: { workflowStatus: WorkflowStatus }) => {
      setWorkflowStatus(update.workflowStatus);
      if (
        update.workflowStatus === WorkflowStatus.COMPLETED ||
        update.workflowStatus === WorkflowStatus.FAILED ||
        update.workflowStatus === WorkflowStatus.ERROR ||
        update.workflowStatus === WorkflowStatus.HALTED
      ) {
        setSending(false);
      }
    },
    [],
  );

  usePusherConnection({
    featureId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
  });

  // ─── Auto-scroll ──────────────────────────────────────────────────
  // `scrollTop = scrollHeight` on the local container — never
  // `scrollIntoView`, which can drag the surrounding `NodeDetail`
  // body around when the chat scroll lands inside it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, workflowStatus]);

  // ─── Pending clarifying-question detection ────────────────────────
  // While a clarifying-questions artifact is awaiting an answer, the
  // workflow is technically `IN_PROGRESS` (the Stakwork run is alive,
  // waiting on user input) — but the input below should stay enabled
  // so the user can answer via the form *or* type a free-form
  // override ("skip these, use defaults"). Mirrors the full plan
  // page's behavior.
  const hasPendingClarifyingQuestion = useMemo(() => {
    return messages.some(
      (m) =>
        (m.artifacts ?? []).some(
          (a) => a.type === "PLAN" && isClarifyingQuestions(a.content),
        ) && !messages.some((reply) => reply.replyId === m.id),
    );
  }, [messages]);

  const inputDisabled =
    loading ||
    sending ||
    (workflowStatus === WorkflowStatus.IN_PROGRESS &&
      !hasPendingClarifyingQuestion);

  // ─── Send ─────────────────────────────────────────────────────────
  // Single internal helper covers both regular sends and clarifying-
  // question answer submissions. The only difference is `replyId` on
  // the answer path, which the server uses to pair the answer back
  // to the artifact's message.
  const sendInternal = useCallback(
    async (text: string, replyId?: string) => {
      const optimistic = createChatMessage({
        id: generateUniqueId(),
        message: text,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId,
        createdBy: session?.user
          ? {
              id: session.user.id,
              name: session.user.name || null,
              email: session.user.email || null,
              image: session.user.image || null,
            }
          : undefined,
      });

      setMessages((m) => [...m, optimistic]);
      setSending(true);
      setWorkflowStatus(WorkflowStatus.IN_PROGRESS);

      try {
        const res = await fetch(`/api/features/${featureId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            replyId,
            sourceWebsocketID: getPusherClient().connection.socket_id,
          }),
        });

        if (!res.ok) throw new Error("send failed");

        const data = await res.json();
        setMessages((m) =>
          m.map((x) =>
            x.id === optimistic.id
              ? { ...data.message, status: ChatStatus.SENT }
              : x,
          ),
        );
      } catch (error) {
        console.error("FeaturePlanChat: send failed", error);
        setMessages((m) =>
          m.map((x) =>
            x.id === optimistic.id ? { ...x, status: ChatStatus.ERROR } : x,
          ),
        );
        setSending(false);
      }
    },
    [featureId, session],
  );

  const handleSend = useCallback(
    (text: string) => sendInternal(text),
    [sendInternal],
  );

  const handleSubmitAnswers = useCallback(
    (messageId: string, formattedAnswers: string) =>
      sendInternal(formattedAnswers, messageId),
    [sendInternal],
  );

  // ─── Reply pairing ────────────────────────────────────────────────
  // Filter out reply messages from the top-level scroll, then pair
  // each remaining message with its reply (if any) so
  // `FeaturePlanChatMessage` can swap the interactive
  // `ClarifyingQuestionsPreview` for the collapsed
  // `AnsweredClarifyingQuestions` once the user has answered.
  const topLevelMessages = useMemo(
    () => messages.filter((m) => !m.replyId),
    [messages],
  );

  const findReply = useCallback(
    (messageId: string) =>
      messages.find((m) => m.replyId === messageId),
    [messages],
  );

  return (
    <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Plan chat
        </span>
        {workflowStatus === WorkflowStatus.IN_PROGRESS && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Planner working…
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[420px] min-h-[80px] overflow-y-auto rounded border bg-muted/20 p-2"
      >
        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : topLevelMessages.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground italic">
            The planner hasn&apos;t said anything yet.
            <br />
            Send a message to start.
          </div>
        ) : (
          <div className="space-y-2">
            {topLevelMessages.map((m) => (
              <FeaturePlanChatMessage
                key={m.id}
                message={m}
                replyMessage={findReply(m.id)}
                onSubmitAnswers={handleSubmitAnswers}
              />
            ))}
          </div>
        )}
      </div>

      <FeaturePlanChatInput onSend={handleSend} disabled={inputDisabled} />

      <div className="text-[10px] text-muted-foreground italic flex items-center gap-1">
        Full plan view (PLAN/TASKS/VERIFY){" "}
        <Link
          href={`/w/${workspaceSlug}/plan/${featureId}`}
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          Open feature
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ─── Input ──────────────────────────────────────────────────────────
const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20;
const MAX_HEIGHT_PX = MAX_ROWS * LINE_HEIGHT_PX;

interface FeaturePlanChatInputProps {
  onSend: (message: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Auto-growing keyboard-only chat input. Mirrors `SidebarChatInput`'s
 * shape (Enter-to-send, Shift+Enter for newline, no attachments) but
 * doesn't share its file because the prop surface differs (no
 * `clearInput` callback dance — we clear on submit synchronously).
 */
function FeaturePlanChatInput({
  onSend,
  disabled = false,
}: FeaturePlanChatInputProps) {
  const [input, setInput] = useState("");
  const [height, setHeight] = useState<string>("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    setInput("");
    setHeight("auto");
    await onSend(trimmed);
    inputRef.current?.focus();
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
          placeholder="Ask the planner…"
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
          className="absolute right-1 bottom-1 h-7 w-7 rounded-full"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </form>
  );
}
