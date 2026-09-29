"use client";

import React from "react";
import { ArrowUpRight, Ban, Blocks, Check, CircleDashed, Loader2, Pause, XCircle } from "lucide-react";
import {
  parseStrutChatActivity,
  type StrutChatRun,
  type StrutChatRunStatus,
  type StrutChatWorkflow,
} from "@/lib/strut-chat-activity";
import { strutChatDeepLink, strutRunDeepLink, strutViewPath, strutWorkflowDeepLink } from "@/lib/utils/strut-links";
import type { CanvasChatMessage } from "../_state/canvasChatStore";

/**
 * StrutChatCard — one card per dispatched strut chat: whether the chat is
 * still running, the workflows it created or edited, and the runs it
 * launched. The chat, each workflow and each run link into the org strut
 * view (`strutViewPath`, the same link a code-change card's "View run" is).
 *
 * A pure projection of the conversation, like `ResearchRunCard`:
 *   - a `dispatch_strut` tool call starts (or continues) the chat — running;
 *   - each `source.kind === "strut"` row is one callback from strut, and
 *     the latest one says where the chat stands and what it has done.
 *
 * Nothing is fetched here. The card is as fresh as strut's last callback:
 * what a turn builds shows when that turn ends.
 */

/** `DISPATCH_STRUT_TOOL` — `@/lib/ai/strutTools` is server code, so the name is repeated here. */
const DISPATCH_STRUT_TOOL = "dispatch_strut";

/** `sent`: dispatched to a strut that will not report back here. */
export type StrutChatStatus = "running" | "done" | "failed" | "paused" | "sent";

export interface StrutChat {
  chatId: string;
  title: string;
  status: StrutChatStatus;
  workflows: StrutChatWorkflow[];
  runs: StrutChatRun[];
  /** The latest message about this chat — the card hangs under it. */
  anchorMessageId: string;
}

export function getStrutChatsFromMessages(messages: CanvasChatMessage[]): StrutChat[] {
  const byChatId = new Map<string, StrutChat>();

  const touch = (chatId: string, anchorMessageId: string, patch: Partial<StrutChat>) => {
    const previous = byChatId.get(chatId);
    byChatId.set(chatId, {
      chatId,
      title: previous?.title ?? "",
      status: previous?.status ?? "running",
      workflows: previous?.workflows ?? [],
      runs: previous?.runs ?? [],
      ...patch,
      anchorMessageId,
    });
  };

  for (const message of messages) {
    if (message.source?.kind === "strut") {
      const { chatId, title, settled, parked, status } = message.source;
      if (!chatId) continue;
      const activity = parseStrutChatActivity(message.source.activity);
      touch(chatId, message.id, {
        ...(title ? { title } : {}),
        status: parked ? "paused" : !settled ? "running" : status === "error" ? "failed" : "done",
        // A row strut could not be read for keeps what the last one said.
        ...(activity ?? {}),
      });
      continue;
    }

    for (const tc of message.toolCalls ?? []) {
      if (tc.toolName !== DISPATCH_STRUT_TOOL) continue;
      const input = (tc.input ?? {}) as { title?: unknown; chatId?: unknown };
      const output = (tc.output ?? {}) as { status?: unknown; chatId?: unknown };
      const chatId =
        typeof output.chatId === "string" ? output.chatId : typeof input.chatId === "string" ? input.chatId : "";
      // A new chat has no id until strut accepts it; a refused dispatch changed nothing.
      if (!chatId || output.status === "error" || tc.errorText) continue;
      touch(chatId, message.id, {
        ...(typeof input.title === "string" && input.title ? { title: input.title } : {}),
        status: output.status === "dispatched_without_callback" ? "sent" : "running",
      });
    }
  }

  return Array.from(byChatId.values());
}

// ── Status ───────────────────────────────────────────────────────────────────

type Tone = "running" | "ok" | "failed" | "muted";

const TONE_PILL_CLASSES: Record<Tone, string> = {
  running: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

const TONE_TEXT_CLASSES: Record<Tone, string> = {
  running: "text-sky-600 dark:text-sky-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  failed: "text-rose-600 dark:text-rose-400",
  muted: "text-muted-foreground",
};

type StatusLook = { label: string; tone: Tone; Icon: typeof Check; spin?: boolean };

const CHAT_STATUS: Record<StrutChatStatus, StatusLook> = {
  running: { label: "Running", tone: "running", Icon: Loader2, spin: true },
  done: { label: "Done", tone: "ok", Icon: Check },
  failed: { label: "Failed", tone: "failed", Icon: XCircle },
  paused: { label: "Paused", tone: "muted", Icon: Pause },
  sent: { label: "Sent", tone: "muted", Icon: Check },
};

const RUN_STATUS: Record<StrutChatRunStatus, StatusLook> = {
  running: { label: "Running", tone: "running", Icon: Loader2, spin: true },
  success: { label: "Succeeded", tone: "ok", Icon: Check },
  error: { label: "Failed", tone: "failed", Icon: XCircle },
  cancelled: { label: "Cancelled", tone: "muted", Icon: Ban },
  stale: { label: "Interrupted", tone: "muted", Icon: CircleDashed },
};

function StatusPill({ look }: { look: StatusLook }) {
  const { label, tone, Icon, spin } = look;
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_PILL_CLASSES[tone]}`}
    >
      <Icon className={`h-3 w-3 ${spin ? "animate-spin" : ""}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A Hive page, opened in a new tab like every cross-view link from the canvas so the chat survives. */
function RowLink({ href, testId, children }: { href: string; testId: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-muted/50"
    >
      {children}
      <ArrowUpRight
        className="h-3 w-3 flex-shrink-0 text-muted-foreground group-hover:text-foreground"
        aria-hidden="true"
      />
    </a>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{children}</div>
  );
}

// ── StrutChatCard ────────────────────────────────────────────────────────────

export function StrutChatCard({ chat, githubLogin }: { chat: StrutChat; githubLogin: string }) {
  return (
    <div
      data-testid="strut-chat-card"
      data-strut-chat-id={chat.chatId}
      className="rounded-lg border bg-card text-card-foreground"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Blocks className="h-3.5 w-3.5 flex-shrink-0 text-violet-500" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm font-medium">{chat.title || "Strut chat"}</span>
        <StatusPill look={CHAT_STATUS[chat.status]} />
        <a
          href={strutViewPath(githubLogin, strutChatDeepLink(chat.chatId))}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="strut-chat-link"
          className="ml-auto inline-flex flex-shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Open chat
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      {(chat.workflows.length > 0 || chat.runs.length > 0) && (
        <div className="space-y-0.5 border-t px-1.5 py-1.5">
          {chat.workflows.length > 0 && <SectionLabel>Workflows</SectionLabel>}
          {chat.workflows.map((workflow) => (
            <RowLink
              key={workflow.name}
              href={strutViewPath(githubLogin, strutWorkflowDeepLink(workflow.name))}
              testId="strut-workflow-link"
            >
              <span className="min-w-0 truncate font-medium">{workflow.name}</span>
              {workflow.version && <span className="flex-shrink-0 text-muted-foreground">{workflow.version}</span>}
              <span className="mr-auto flex-shrink-0 text-muted-foreground">
                {workflow.action === "created" ? "created" : "edited"}
              </span>
            </RowLink>
          ))}

          {chat.runs.length > 0 && <SectionLabel>Runs</SectionLabel>}
          {chat.runs.map((run) => {
            const look = RUN_STATUS[run.status];
            return (
              <RowLink
                key={run.runId}
                href={strutViewPath(githubLogin, strutRunDeepLink(run.workflow, run.runId))}
                testId="strut-run-link"
              >
                <look.Icon
                  className={`h-3 w-3 flex-shrink-0 ${TONE_TEXT_CLASSES[look.tone]} ${look.spin ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate font-medium">{run.workflow}</span>
                <span className="min-w-0 truncate text-muted-foreground">{run.runId}</span>
                <span className={`mr-auto flex-shrink-0 ${TONE_TEXT_CLASSES[look.tone]}`}>{look.label}</span>
              </RowLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
