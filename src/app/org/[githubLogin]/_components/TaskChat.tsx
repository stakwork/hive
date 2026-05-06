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
  type Option,
} from "@/lib/chat";
import { usePusherConnection } from "@/hooks/usePusherConnection";
import { getPusherClient } from "@/lib/pusher";
import { Button } from "@/components/ui/button";
import { TaskChatMessage } from "./TaskChatMessage";

/**
 * Compact, sidebar-shaped task chat for the org canvas.
 *
 * Mounted inside `NodeDetail`'s `case "task"` arm so the user can
 * read and continue a task's conversation without navigating away
 * from the canvas. Reads from `/api/tasks/[taskId]/messages`,
 * writes to the shared `/api/chat/message` endpoint (the same one
 * the full task page uses), and subscribes to the same Pusher
 * channel for live updates — so a message sent from the canvas
 * appears on the full task page in real time, and vice versa.
 *
 * Structurally this is the task-flavored sibling of
 * `FeaturePlanChat`; the differences come from the underlying
 * concept rather than the chat surface itself:
 *
 *   - **API endpoints differ.** Tasks fetch from
 *     `/api/tasks/[id]/messages` and POST to `/api/chat/message`
 *     (with `taskId`); features fetch from `/api/features/[id]/chat`
 *     and POST to that same endpoint.
 *   - **Interactive artifact differs.** Tasks use `FORM` artifacts
 *     for clarifying prompts (button-row UI), where features use
 *     `PLAN` + `ask_clarifying_questions` (free-text Q&A form).
 *     Both surface as inline interactive elements; the renderer
 *     forks lives in `TaskChatMessage` / `FeaturePlanChatMessage`.
 *
 * What this surface deliberately omits compared to the full task
 * page (`/w/<slug>/task/<id>`):
 *
 *   - No artifacts panel (CODE / BROWSER / IDE / DIFF / PR / etc.).
 *     The "Open task" link below is the escape hatch.
 *   - No file/image attachments, no debug capture.
 *   - No project-log streaming, no chain-of-thought visualization.
 *   - No pod controls (release / restart).
 */
interface TaskChatProps {
  /** Prisma `Task.id`. Drives the chat fetch + Pusher channel. */
  taskId: string;
  /** Workspace slug the task belongs to. Used by the "Open task" link. */
  workspaceSlug: string;
  /**
   * Live workflow status from the canvas node API
   * (`extras.workflowStatus`). Used to seed initial state without a
   * second `/api/tasks/[id]` round-trip; Pusher takes over after
   * mount.
   */
  initialWorkflowStatus?: WorkflowStatus | null;
}

function generateUniqueId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function TaskChat({
  taskId,
  workspaceSlug,
  initialWorkflowStatus = null,
}: TaskChatProps) {
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
    fetch(`/api/tasks/${taskId}/messages`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => {
        if (cancelled) return;
        // The task messages route returns `{ success, data }` like
        // the feature route does; fall back to `body` if a future
        // change drops the wrapper.
        const data = (body?.data ?? body ?? []) as ChatMessage[];
        setMessages(Array.isArray(data) ? data : []);
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
  }, [taskId]);

  // ─── Pusher subscription ──────────────────────────────────────────
  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      // Pusher can echo our own optimistic message back; dedupe by id.
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
    taskId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
  });

  // ─── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, workflowStatus]);

  // ─── Pending FORM detection ───────────────────────────────────────
  // While a FORM artifact is awaiting a button click, the workflow
  // is `IN_PROGRESS` (waiting on user input) — but the input below
  // should stay enabled so the user can answer via the form *or*
  // type a free-form override. Mirrors the full task page's behavior
  // (`page.tsx:hasActionArtifact`).
  const hasPendingForm = useMemo(() => {
    return messages.some(
      (m) =>
        (m.artifacts ?? []).some((a) => a.type === "FORM") &&
        !messages.some((reply) => reply.replyId === m.id),
    );
  }, [messages]);

  const inputDisabled =
    loading ||
    sending ||
    (workflowStatus === WorkflowStatus.IN_PROGRESS && !hasPendingForm);

  // ─── Send ─────────────────────────────────────────────────────────
  // Single internal helper covers both regular sends and FORM-button
  // replies. Replies just attach `replyId` (and optionally a webhook
  // override the FORM artifact carries on its options).
  const sendInternal = useCallback(
    async (
      text: string,
      opts?: { replyId?: string; webhook?: string },
    ) => {
      const optimistic = createChatMessage({
        id: generateUniqueId(),
        message: text,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: opts?.replyId,
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
        const res = await fetch(`/api/chat/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            message: text,
            contextTags: [],
            sourceWebsocketID: getPusherClient().connection.socket_id,
            ...(opts?.replyId && { replyId: opts.replyId }),
            ...(opts?.webhook && { webhook: opts.webhook }),
          }),
        });

        if (!res.ok) throw new Error("send failed");

        const data = await res.json();
        // The task chat endpoint returns `{ success, message }` —
        // swap the optimistic placeholder with the persisted record
        // so future Pusher echoes dedupe on the real id.
        if (data?.message) {
          setMessages((m) =>
            m.map((x) =>
              x.id === optimistic.id
                ? { ...data.message, status: ChatStatus.SENT }
                : x,
            ),
          );
        } else {
          setMessages((m) =>
            m.map((x) =>
              x.id === optimistic.id ? { ...x, status: ChatStatus.SENT } : x,
            ),
          );
        }
      } catch (error) {
        console.error("TaskChat: send failed", error);
        setMessages((m) =>
          m.map((x) =>
            x.id === optimistic.id ? { ...x, status: ChatStatus.ERROR } : x,
          ),
        );
        setSending(false);
      }
    },
    [taskId, session],
  );

  const handleSend = useCallback(
    (text: string) => sendInternal(text),
    [sendInternal],
  );

  /**
   * FORM-artifact button click. The user picked one of the agent's
   * suggested options; we send the canonical `optionResponse` text
   * back, paired by `replyId` to the artifact's message and tagged
   * with the option's per-button webhook so the planner's branching
   * logic fires correctly.
   */
  const handleArtifactAction = useCallback(
    async (messageId: string, action: Option, webhook: string) => {
      await sendInternal(action.optionResponse, {
        replyId: messageId,
        webhook,
      });
    },
    [sendInternal],
  );

  // ─── Reply pairing ────────────────────────────────────────────────
  const topLevelMessages = useMemo(
    () => messages.filter((m) => !m.replyId),
    [messages],
  );

  const findReply = useCallback(
    (messageId: string) => messages.find((m) => m.replyId === messageId),
    [messages],
  );

  return (
    <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Task chat
        </span>
        {workflowStatus === WorkflowStatus.IN_PROGRESS && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Agent working…
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
            No messages yet.
            <br />
            Send a message to start.
          </div>
        ) : (
          <div className="space-y-2">
            {topLevelMessages.map((m) => (
              <TaskChatMessage
                key={m.id}
                message={m}
                replyMessage={findReply(m.id)}
                onArtifactAction={handleArtifactAction}
                taskHref={`/w/${workspaceSlug}/task/${taskId}`}
              />
            ))}
          </div>
        )}
      </div>

      <TaskChatInput onSend={handleSend} disabled={inputDisabled} />

      <div className="text-[10px] text-muted-foreground italic flex items-center gap-1">
        Full task view{" "}
        <Link
          href={`/w/${workspaceSlug}/task/${taskId}`}
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          Open task
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

interface TaskChatInputProps {
  onSend: (message: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Auto-growing keyboard-only chat input. Identical UX to
 * `FeaturePlanChatInput`; the components don't share a file because
 * the prop surface is locally simpler and the hook deps don't carry.
 */
function TaskChatInput({ onSend, disabled = false }: TaskChatInputProps) {
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
          placeholder="Reply to the agent…"
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
