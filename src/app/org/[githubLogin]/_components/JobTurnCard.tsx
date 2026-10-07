"use client";

import React, { useState } from "react";
import { Ban, Briefcase, Check, ChevronDown, CircleDashed, HelpCircle, XCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { CanvasChatMessage } from "../_state/canvasChatStore";

/**
 * JobTurnCard — one turn of a strut job (`source.kind === "job"`, the row
 * `services/strut-runs/job-turn.ts` appends), shown collapsed.
 *
 * The row is the record: the job's agent writes in detail — a code change
 * lists files, functions and line numbers — and the canvas agent is woken
 * to summarize it (`canvas-strut-autoturn.ts`). So the card is the header
 * line (title, how the turn ended) and opens on click to the full reply.
 * What stays visible collapsed is what asks something of the reader: the
 * job's question, or why a turn failed. The artifacts the turn produced
 * are the row's `artifacts` and render as cards under this one
 * (`SidebarChat`'s `MessageArtifacts`), not inside it.
 *
 * A pure projection of the message, like `StrutChatCard`: nothing is
 * fetched, and the expansion is this card's own state.
 */

export type JobTurnSource = Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "job" }>;

type Tone = "ok" | "attention" | "failed" | "muted";

const TONE_PILL_CLASSES: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

export type JobTurnLook = { label: string; tone: Tone; Icon: typeof Check };

/** How the turn ended, as the pill says it. */
export function jobTurnLook(source: Pick<JobTurnSource, "status" | "ask">): JobTurnLook {
  switch (source.status) {
    case "success":
      return source.ask
        ? { label: "Needs an answer", tone: "attention", Icon: HelpCircle }
        : { label: "Done", tone: "ok", Icon: Check };
    case "error":
      return { label: "Failed", tone: "failed", Icon: XCircle };
    case "cancelled":
      return { label: "Stopped", tone: "muted", Icon: Ban };
    case "lost":
      return { label: "Lost", tone: "muted", Icon: CircleDashed };
    default:
      return { label: "Ended", tone: "muted", Icon: CircleDashed };
  }
}

/**
 * The reply without its header line (`**Job · <id> · <title>**`, which the
 * canvas agent reads the job id from): the card's own header says it.
 */
export function jobTurnBody(content: string): string {
  const text = content.trim();
  if (!text.startsWith("**Job · ")) return text;
  const newline = text.indexOf("\n");
  return newline === -1 ? "" : text.slice(newline + 1).trim();
}

function StatusPill({ look }: { look: JobTurnLook }) {
  const { label, tone, Icon } = look;
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_PILL_CLASSES[tone]}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function JobTurnCard({
  message,
  source,
}: {
  message: Pick<CanvasChatMessage, "content">;
  source: JobTurnSource;
}) {
  const [open, setOpen] = useState(false);
  const look = jobTurnLook(source);
  const body = jobTurnBody(message.content);
  // A turn that did not succeed is one line saying why: always shown, nothing to open.
  const collapsible = source.status === "success" && body.length > 0;
  const expanded = collapsible ? open : body.length > 0;
  const title = source.title || "Job";

  const header = (
    <>
      <Briefcase className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{title}</span>
      <StatusPill look={look} />
      {collapsible && (
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      )}
    </>
  );

  return (
    <div
      data-testid="job-turn-card"
      data-job-id={source.jobId}
      data-expanded={expanded ? "true" : "false"}
      className="rounded-lg border bg-card text-card-foreground"
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="job-turn-toggle"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-muted/50"
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5">{header}</div>
      )}

      {!expanded && source.ask && (
        <div data-testid="job-turn-ask" className="border-t px-3 py-2 text-xs text-foreground/90">
          <span className="font-medium">Question for you:</span> {source.ask}
        </div>
      )}

      {expanded && (
        <div data-testid="job-turn-body" className="border-t px-3 py-2">
          <MarkdownRenderer className="text-sm [&>*]:!text-foreground/90 [&_*]:!text-foreground/90">
            {body}
          </MarkdownRenderer>
        </div>
      )}
    </div>
  );
}
