/**
 * Strut jobs on the infinite canvas's cards (`docs/plans/infinite-canvas.md`
 * §2.3–4). Pure: no server or client imports, so the launch, the webhook,
 * the read route and `useCanvasJobs` share one shape.
 *
 *  - **Focus.** The card a person was on when they asked Jamie
 *    (`InitiativeFocusHint`, parsed off the chat request) is stored on the
 *    orchestrator turn's `StrutRun.input.focus` and copied onto the
 *    `job_turn` rows that turn starts: a job is on the card its turn was
 *    about. Strut is told the same thing as text, in the context line.
 *  - **Nudge.** What changes about a job on a card goes to the org channel
 *    as `PUSHER_EVENTS.CANVAS_CARD_JOB` — ids and state only, never titles,
 *    names or links (the org channel is public, like `CANVAS_PR_UPDATED`'s
 *    nudge): the canvas reads the rest through the authenticated route.
 */

import { z } from "zod";
import type { InitiativeFocusHint } from "@/lib/canvas/graph-focus";

/** The card a job is on — `StrutRun.input.focus`. */
export type CanvasFocus = {
  workspaceSlug: string;
  initiativeRefId: string;
  initiativeName: string;
  /** The card: the selected one, else the initiative itself. */
  refId: string;
  /** The selected card's node type and label; absent when the card is the initiative. */
  refType?: string;
  refLabel?: string;
};

export const canvasFocusSchema = z.object({
  workspaceSlug: z.string().min(1),
  initiativeRefId: z.string().min(1),
  initiativeName: z.string(),
  refId: z.string().min(1),
  refType: z.string().optional(),
  refLabel: z.string().optional(),
});

/** The focus a parsed chat request names (already sanitised by `parseInitiativeFocus`). */
export function canvasFocusOf(hint: InitiativeFocusHint): CanvasFocus {
  return {
    workspaceSlug: hint.workspaceSlug,
    initiativeRefId: hint.initiativeRefId,
    initiativeName: hint.initiativeName,
    refId: hint.selectedRefId ?? hint.initiativeRefId,
    ...(hint.selectedRefId && hint.selectedType ? { refType: hint.selectedType } : {}),
    ...(hint.selectedRefId && hint.selectedLabel ? { refLabel: hint.selectedLabel } : {}),
  };
}

/** `input.focus` off a `StrutRun` row's input; null when it has none. */
export function canvasFocusOfInput(input: unknown): CanvasFocus | null {
  if (!input || typeof input !== "object") return null;
  const parsed = canvasFocusSchema.safeParse((input as { focus?: unknown }).focus);
  return parsed.success ? parsed.data : null;
}

const TYPE_WORDS: Record<string, string> = {
  HiveInitiative: "initiative",
  HiveMilestone: "milestone",
  InitiativeFeature: "feature",
  UserStory: "user story",
  Requirement: "requirement",
  Brief: "brief",
  Question: "brainstorm question",
  Option: "brainstorm option",
};

/** A node type as a word: `InitiativeFeature` → "feature". */
export function nodeTypeWord(type: string | undefined): string {
  if (!type) return "card";
  return TYPE_WORDS[type] ?? (type.replace(/^(Hive|Initiative)(?=[A-Z])/, "").toLowerCase() || "card");
}

/**
 * The focus as strut reads it, appended to `context.line`:
 * `On the canvas: initiative "Self-serve onboarding" (`ref`), feature "Repo picker" (`ref`). `
 * The names are already stripped of quotes and backticks.
 */
export function canvasFocusContextLine(focus: CanvasFocus): string {
  const parts = [`initiative "${focus.initiativeName}" (\`${focus.initiativeRefId}\`)`];
  if (focus.refId !== focus.initiativeRefId) {
    const label = focus.refLabel ? ` "${focus.refLabel}"` : "";
    parts.push(`${nodeTypeWord(focus.refType)}${label} (\`${focus.refId}\`)`);
  }
  return `On the canvas: ${parts.join(", ")} in workspace \`${focus.workspaceSlug}\`. `;
}

// ─── The nudge ───────────────────────────────────────────────────────────

export type CanvasJobState = "running" | "done" | "failed";

/** `PUSHER_EVENTS.CANVAS_CARD_JOB` on the org channel. */
export interface CanvasCardJobNudge {
  jobId: string;
  /** The job turn's `StrutRun.id`, once hive has a row for it. */
  runId?: string;
  state: CanvasJobState;
  refId: string;
  initiativeRefId: string;
  workspaceSlug: string;
  /** Epoch ms. */
  at: number;
  /** What the job just reported (`job.update`'s `kind`: shot, recording, pod, verify…). */
  latest?: { kind: string };
}

// ─── What the canvas shows ───────────────────────────────────────────────

export interface CanvasJob {
  jobId: string;
  runId?: string;
  title: string;
  state: CanvasJobState;
  startedBy: { id: string; name: string | null } | null;
  refId: string;
  initiativeRefId: string;
  updatedAt: number;
  latest?: { kind: string; title?: string; url?: string };
  /** Why a failed job failed, in a line (`StrutRun.error`). */
  error?: string;
}

/**
 * Live nudges kept since the route was last read: job id → its newest
 * state. Pure; a nudge older than the one kept, or about another
 * initiative, changes nothing (the same object comes back).
 */
export function applyCanvasJobNudge(
  live: Record<string, CanvasCardJobNudge>,
  nudge: CanvasCardJobNudge,
  initiativeRefId: string | null,
): Record<string, CanvasCardJobNudge> {
  if (!initiativeRefId || nudge.initiativeRefId !== initiativeRefId) return live;
  const kept = live[nudge.jobId];
  if (kept && kept.at > nudge.at) return live;
  // A job that settled stays settled until a newer turn says it runs again.
  const latest = nudge.latest ?? kept?.latest;
  return { ...live, [nudge.jobId]: { ...nudge, ...(latest ? { latest } : {}), runId: nudge.runId ?? kept?.runId } };
}

/**
 * The route's jobs with the live nudges laid over them, grouped by card,
 * newest first. A nudge about a job the route has not returned yet (its
 * row is minted when the orchestrator turn settles) shows as an untitled
 * job until the next read. Pure.
 */
export function canvasJobsByRef(
  read: readonly CanvasJob[],
  live: Record<string, CanvasCardJobNudge>,
): Record<string, CanvasJob[]> {
  const jobs = new Map<string, CanvasJob>(read.map((j) => [j.jobId, j]));
  for (const n of Object.values(live)) {
    const base = jobs.get(n.jobId);
    if (base && base.updatedAt > n.at) continue;
    jobs.set(n.jobId, {
      jobId: n.jobId,
      title: base?.title ?? "Job",
      startedBy: base?.startedBy ?? null,
      ...((n.runId ?? base?.runId) ? { runId: n.runId ?? base?.runId } : {}),
      state: n.state,
      refId: n.refId,
      initiativeRefId: n.initiativeRefId,
      updatedAt: n.at,
      ...(n.latest ? { latest: n.latest } : base?.latest ? { latest: base.latest } : {}),
    });
  }
  const byRef: Record<string, CanvasJob[]> = {};
  for (const j of jobs.values()) (byRef[j.refId] ??= []).push(j);
  for (const list of Object.values(byRef)) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return byRef;
}
