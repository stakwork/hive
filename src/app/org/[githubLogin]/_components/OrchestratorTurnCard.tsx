"use client";

import React from "react";
import { Bot, Check, Loader2, X, XCircle } from "lucide-react";
import type { CanvasChatMessage } from "../_state/canvasChatStore";
import { orchestratorRowId } from "@/lib/strut-orchestrator";
import { jamieName } from "@/lib/constants/jamie";

/**
 * Jamie on strut (`lib/strut-orchestrator.ts`): the working card a turn
 * shows while strut has it, and the quiet line a person's decision on one
 * of its proposals leaves. The reply itself is a plain bubble
 * (`SidebarChatMessage`); the proposals are `StrutProposalCard`s.
 *
 * The launch marker (`source.kind: "orchestrator_launch"`) is written as
 * the turn launches; the card hangs on it until the reply row
 * (`orchestrator-<runId>`) is in the conversation, then it renders nothing.
 * A pure projection of the conversation: nothing is fetched.
 */

export type OrchestratorLaunchSource = Extract<
  NonNullable<CanvasChatMessage["source"]>,
  { kind: "orchestrator_launch" }
>;
export type StrutProposalResultSource = Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "proposal_result" }>;

/** The launch rows whose reply row has not landed, by row id. */
export function pendingOrchestratorLaunchIds(
  messages: ReadonlyArray<Pick<CanvasChatMessage, "id" | "source">>,
): Set<string> {
  const replies = new Set(messages.filter((m) => m.source?.kind === "orchestrator").map((m) => m.id));
  const pending = new Set<string>();
  for (const m of messages) {
    if (m.source?.kind === "orchestrator_launch" && !replies.has(orchestratorRowId(m.source.runId))) pending.add(m.id);
  }
  return pending;
}

/**
 * `source` is the launch marker; without one (the canvas bar, before the marker has synced) it's the same card.
 * `detail` is a short note after the title (the canvas bar: what the turn's jobs are).
 */
export function PendingOrchestratorTurnCard({
  source,
  detail,
}: {
  source?: OrchestratorLaunchSource;
  detail?: string;
}) {
  return (
    <div
      data-testid="orchestrator-turn-pending-card"
      data-run-id={source?.runId}
      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-card-foreground"
    >
      <Bot className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark-os:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {jamieName} is working on it
        {detail ? <span className="font-normal text-muted-foreground"> · {detail}</span> : null}
      </span>
      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-sky-700 ring-1 ring-inset ring-sky-500/20 dark-os:text-sky-300">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Running
      </span>
    </div>
  );
}

/** "Applied: <title>" / "Rejected: <title>" / "Failed: …" — a quiet line where the decision was made. */
export function StrutProposalResultRow({
  message,
  source,
}: {
  message: Pick<CanvasChatMessage, "content">;
  source: StrutProposalResultSource;
}) {
  const Icon =
    source.status === "applied" || source.status === "accepted" ? Check : source.status === "rejected" ? X : XCircle;
  const tone =
    source.status === "applied" || source.status === "accepted"
      ? "text-emerald-700 dark-os:text-emerald-300"
      : source.status === "rejected"
        ? "text-muted-foreground"
        : "text-rose-700 dark-os:text-rose-300";
  return (
    <p
      data-testid="strut-proposal-result-row"
      data-proposal-id={source.proposalId}
      className={`flex items-center gap-1.5 px-1 text-xs ${tone}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{message.content}</span>
    </p>
  );
}
