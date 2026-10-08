"use client";

import React, { useState } from "react";
import { Ban, Bot, Check, ChevronRight, CircleDashed, HelpCircle, Loader2, XCircle, Zap } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { describeArtifactEvent, parseArtifactEvent } from "@/lib/strut-jobs";
import type { CanvasChatMessage } from "../_state/canvasChatStore";

/**
 * JobTurnCard — one turn of a strut job (`source.kind === "job"`, the row
 * `services/strut-runs/job-turn.ts` appends), shown collapsed.
 *
 * The row is the record: the job's agent writes in detail — a code change
 * lists files, functions and line numbers — and the canvas agent is woken
 * to summarize it (`canvas-strut-autoturn.ts`). So the card is the header
 * line (title, how the turn ended) and opens on click to the full reply.
 * The chevron leads the row, and what opens is indented under the title
 * on a guide line, so the job's report reads apart from the chat's own
 * text.
 * What stays visible collapsed is what asks something of the reader: the
 * job's question, or why a turn failed. The artifacts the turn produced
 * are the row's `artifacts` and render as cards under this one
 * (`SidebarChat`'s `MessageArtifacts`), not inside it.
 *
 * A turn strut is still working on has no row yet. `PendingJobTurnCard`
 * shows it from the launch alone — `getPendingJobTurnsFromMessages` pairs
 * each `start_job` / `continue_job` call strut accepted with the job row
 * that follows it, and a launch with no row yet is pending — under the
 * message that made the call, until the row lands and takes its place.
 * A turn hive started for an event about an artifact the job reported
 * (`source.kind === "job_event"`, strut plans/job-artifact-events.md) has
 * no call: its origin row is the launch marker, shown by `JobEventRow`
 * with the card under it.
 *
 * Pure projections of the conversation, like `StrutChatCard`: nothing is
 * fetched, and the expansion is the settled card's own state.
 */

export type JobTurnSource = Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "job" }>;
export type JobEventSource = Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "job_event" }>;

type Tone = "running" | "ok" | "attention" | "failed" | "muted";

const TONE_PILL_CLASSES: Record<Tone, string> = {
  running: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

export type JobTurnLook = { label: string; tone: Tone; Icon: typeof Check; spin?: boolean };

/** A turn strut has accepted and not yet reported. */
export const RUNNING_LOOK: JobTurnLook = { label: "Running", tone: "running", Icon: Loader2, spin: true };

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

// ─── Pending turns ──────────────────────────────────────────────────────

/** `START_JOB_TOOL` / `CONTINUE_JOB_TOOL` — `@/lib/ai/strutTools` is server code, so the names are repeated here. */
const START_JOB_TOOL = "start_job";
const CONTINUE_JOB_TOOL = "continue_job";

export interface PendingJobTurn {
  jobId: string;
  title: string;
  /** The message whose tool call launched the turn — the card hangs under it. */
  anchorMessageId: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * The job turns strut is still working on: a `start_job` / `continue_job`
 * call strut accepted (`status: "started" | "continued"`) with no job row
 * for it yet.
 *
 * Walked in order. A job has one unsettled turn at a time (the tools'
 * busy guard), so a job's row settles its latest launch; and the server
 * persists the launching turn before a job turn can settle (the turn ends
 * as soon as the tool returns; a job takes seconds to minutes), so the
 * row never comes first. A refused launch (`busy`, `error`) or an
 * interrupted call changed nothing on strut and draws nothing. A pending
 * turn always ends: Stop cancels the run on strut, which reports back a
 * Stopped row, and a run strut never reports is reconciled to a Lost row.
 *
 * An event row is a launch too — written once strut has the turn, so a
 * row never waits on a turn that did not start — and the job row that
 * follows settles it. Its run is named (`runId`), so a job row that landed
 * BEFORE the origin was written (the write is after the dispatch) is seen
 * for what it is and the event draws nothing.
 */
export function getPendingJobTurnsFromMessages(messages: CanvasChatMessage[]): PendingJobTurn[] {
  const pending = new Map<string, PendingJobTurn>();
  /** The last title seen for each job, for a launch whose call carries none. */
  const titles = new Map<string, string>();
  /** Every job row's id (`job-<StrutRun.id>`), for an event row whose turn has already settled. */
  const rows = new Set(messages.filter((m) => m.source?.kind === "job").map((m) => m.id));

  for (const message of messages) {
    if (message.source?.kind === "job") {
      const { jobId, title } = message.source;
      if (title) titles.set(jobId, title);
      pending.delete(jobId);
      continue;
    }
    if (message.source?.kind === "job_event") {
      const { jobId, title, runId } = message.source;
      if (title) titles.set(jobId, title);
      if (!rows.has(`job-${runId}`)) {
        pending.set(jobId, { jobId, title: title ?? titles.get(jobId) ?? "", anchorMessageId: message.id });
      }
      continue;
    }

    for (const tc of message.toolCalls ?? []) {
      if (tc.toolName !== START_JOB_TOOL && tc.toolName !== CONTINUE_JOB_TOOL) continue;
      if (tc.errorText) continue;
      const input = (tc.input ?? {}) as { title?: unknown; jobId?: unknown };
      const output = (tc.output ?? {}) as { status?: unknown; jobId?: unknown; title?: unknown };
      if (output.status !== "started" && output.status !== "continued") continue;
      const jobId = str(output.jobId) ?? str(input.jobId);
      if (!jobId) continue;
      const title = str(output.title) ?? str(input.title) ?? titles.get(jobId) ?? "";
      if (title) titles.set(jobId, title);
      pending.set(jobId, { jobId, title, anchorMessageId: message.id });
    }
  }

  return Array.from(pending.values());
}

// ─── Cards ──────────────────────────────────────────────────────────────

function JobIcon() {
  return <Bot className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
}

/** The disclosure chevron, or an empty slot of its width so titles line up down the column. */
function Disclosure({ open }: { open?: boolean }) {
  if (open === undefined) return <span className="h-4 w-4 flex-shrink-0" aria-hidden="true" />;
  return (
    <ChevronRight
      className={`h-4 w-4 flex-shrink-0 text-foreground/70 transition-transform group-hover:text-foreground motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    />
  );
}

const HEADER_CLASSES = "flex items-center gap-2 py-2.5 pl-2 pr-3";
/** Under the title: the guide line hangs from the chevron's center, the text starts at the title's edge. */
const INDENTED_CLASSES = "mb-2.5 ml-[15px] mr-3 border-l-2 pl-[37px]";

function StatusPill({ look }: { look: JobTurnLook }) {
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

/**
 * A turn hive started for an event about an artifact the job reported:
 * the event, quietly, where a person's words would be — the job's title,
 * then `pull request acme/app#12 merged` linked to the artifact. The
 * working card hangs under it until the job row lands.
 */
export function JobEventRow({ message, source }: { message: Pick<CanvasChatMessage, "content">; source: JobEventSource }) {
  const event = parseArtifactEvent(message.content);
  const text = event ? describeArtifactEvent(event) : message.content.split("\n")[0];
  return (
    <div
      data-testid="job-event-row"
      data-job-id={source.jobId}
      className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      <Zap className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{source.title || "Job"}</span>
        {" · "}
        {event ? (
          <a href={event.url} target="_blank" rel="noreferrer" className="hover:underline">
            {text}
          </a>
        ) : (
          text
        )}
      </span>
    </div>
  );
}

/** A turn strut is working on: its title and a running pill, nothing to open yet. */
export function PendingJobTurnCard({ turn }: { turn: PendingJobTurn }) {
  return (
    <div
      data-testid="job-turn-pending-card"
      data-job-id={turn.jobId}
      className="rounded-lg border bg-card text-card-foreground"
    >
      <div className={HEADER_CLASSES}>
        <Disclosure />
        <JobIcon />
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{turn.title || "Job"}</span>
        <StatusPill look={RUNNING_LOOK} />
      </div>
    </div>
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
      <Disclosure open={collapsible ? open : undefined} />
      <JobIcon />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{title}</span>
      <StatusPill look={look} />
    </>
  );

  return (
    <div
      data-testid="job-turn-card"
      data-job-id={source.jobId}
      data-expanded={expanded ? "true" : "false"}
      className={`rounded-lg border bg-card text-card-foreground ${collapsible ? "transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-sm motion-reduce:transition-none" : ""}`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="job-turn-toggle"
          className={`group w-full rounded-lg ${HEADER_CLASSES}`}
        >
          {header}
        </button>
      ) : (
        <div className={HEADER_CLASSES}>{header}</div>
      )}

      {!expanded && source.ask && (
        <div data-testid="job-turn-ask" className={`${INDENTED_CLASSES} text-xs text-foreground/90`}>
          <span className="font-medium">Question for you:</span> {source.ask}
        </div>
      )}

      {expanded && (
        <div data-testid="job-turn-body" className={INDENTED_CLASSES}>
          <MarkdownRenderer className="text-sm [&>*]:!text-foreground/90 [&_*]:!text-foreground/90">
            {body}
          </MarkdownRenderer>
        </div>
      )}
    </div>
  );
}
