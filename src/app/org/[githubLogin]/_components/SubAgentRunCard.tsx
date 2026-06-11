"use client";

import { useState } from "react";
import {
  ExternalLink,
  Loader2,
  Send,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { SEND_TO_FEATURE_PLANNER_TOOL } from "@/lib/proposals/types";
import type { CanvasChatMessage } from "../_state/canvasChatStore";
import type { ClarifyingQuestion } from "@/types/stakwork";
import { FeaturePlanDialog } from "./FeaturePlanDialog";

/**
 * SubAgentRunCard — a "conversation thread" card showing the canvas
 * agent's exchange with a single feature planner across the active
 * conversation.
 *
 * Design rationale (see chat transcript "Option A"):
 *
 *   - One card per `featureId`, not per tool-call. The canvas agent
 *     may message the same planner several times during a single
 *     user-driven thread (e.g. *"proceed to architecture"* →
 *     *"actually, hold off on auth fields"*). Rendering N cards in
 *     a row would be noisy and the "waiting for reply" status on the
 *     older cards would lie.
 *   - The card is **anchored to the most recent** `send_to_feature_planner`
 *     call for that feature. As the user prompts the canvas agent
 *     further and it messages the same planner again, the card moves
 *     down with the conversation scroll — which is what users expect:
 *     the freshest exchange is the one that needs eyes.
 *   - Status is **derived** per-call from the tool output, not stored
 *     anywhere. The card walks all matching tool calls in the
 *     conversation, projects each one into a thread entry, and shows
 *     the latest status as the card's headline.
 *   - The card is **read-only** in v1. The planner replies are visible
 *     on the per-feature plan page (`/w/<slug>/plan/<featureId>`)
 *     which the card links to. A future iteration could subscribe
 *     to the feature's Pusher channel and flip status from "waiting"
 *     to "replied" without a re-read — but per CLAUDE-flagged tradeoff
 *     we ship the no-Pusher version first to validate the layout.
 *
 * Not in the store: the card is a pure projection of
 * `message.toolCalls[]`, identical pattern to `ProposalCard` /
 * `getProposalsFromMessage`. Adding a `subAgentRuns` slice would be
 * premature — auto-save round-trips tool calls through
 * `SharedConversation.messages` JSON for free, so deriving on every
 * render is correct.
 */

/** One round-trip the canvas agent had with the planner. */
interface RunMessage {
  /** The id of the canvas-chat message that emitted/carries this entry. */
  messageId: string;
  /** The position in the overall conversation; lets us sort runs by recency. */
  messageIndex: number;
  /**
   * Direction of the entry from the canvas agent's POV:
   *   - `"out"`: canvas agent → planner (a `send_to_feature_planner`
   *     tool call) OR the user answering a planner FORM in canvas chat
   *     (a `user-answered-planner-form` row — `formAnswer: true`).
   *   - `"in"`: planner → canvas (a fan-out row carrying
   *     `source: { kind: "planner", ... }`, written by
   *     `fanOutPlannerMessageToCanvas`).
   */
  direction: "out" | "in";
  /**
   * `true` for the third entry class (Phase 4): the user answered a
   * planner FORM directly in canvas chat. Rendered with a `✓` instead
   * of `→` to distinguish it from a canvas-agent send.
   */
  formAnswer?: boolean;
  /**
   * For `"out"`: the message body the canvas agent passed via
   * `message` input.
   * For `"in"`: the planner's ASSISTANT message content (verbatim
   * from `ChatMessage.message`).
   */
  text: string;
  /**
   * Outcome of an outbound send. Inbound entries are always `"sent"`
   * — they only exist because the planner wrote something.
   */
  status: "sent" | "in_flight" | "failed";
  /** Failure reason for outbound `"failed"` entries. */
  errorReason?: string;
  /**
   * Inbound only (Phase 3): the feature's `workflowStatus` at the time
   * the planner posted, carried on `source.workflowStatus`. Drives the
   * card's status pill. `undefined` for outbound entries and for
   * inbound rows written before Phase 3.
   */
  workflowStatus?: string;
  /**
   * Inbound only (Phase 3): `true` when the planner message carried a
   * clarifying-questions artifact (an explicit "a human must pick").
   * Highest-priority signal for the status pill.
   */
  hasForm?: boolean;
  /**
   * Inbound only (Phase 4): the planner message id that asked the
   * question, used to pair an inbound FORM with its
   * `user-answered-planner-form` reply (matched on `plannerMessageId`).
   */
  plannerMessageId?: string;
  /**
   * Inbound only (Phase 4): the embedded clarifying-question list
   * (`source.formQuestions`). Present iff `hasForm`. Rendered by
   * `PlannerFormSlot` when this is the run's unanswered FORM.
   */
  formQuestions?: ClarifyingQuestion[];
  /**
   * Inbound only: `true` when the planner generated a task breakdown
   * (`source.hasTasks`). Gates the run's **Start Tasks** affordance.
   */
  hasTasks?: boolean;
}

/** All exchanges with one planner during the active conversation. */
export interface SubAgentRun {
  featureId: string;
  featureTitle: string;
  workspaceSlug: string;
  workspaceName: string;
  /** Chronologically ordered (oldest first). */
  messages: RunMessage[];
  /**
   * `messageId` of the most recent `send_to_feature_planner` call in
   * this run. Used by `SidebarChat` to decide which chat message the
   * card hangs under — only the anchor message renders the card, so
   * a run with 3 sends shows as one card under the 3rd send, not 3.
   */
  anchorMessageId: string;
  /**
   * Phase 4: the planner's most recent UNANSWERED clarifying-questions
   * FORM, if any. Set when the latest inbound entry carries
   * `formQuestions` AND no `user-answered-planner-form` row references
   * its `plannerMessageId`. `SidebarChat` renders `PlannerFormSlot`
   * from this; the card's pill reads `Waiting for you` while it's set.
   * `undefined` once answered (or when the planner never asked).
   */
  pendingForm?: {
    plannerMessageId: string;
    questions: ClarifyingQuestion[];
  };
  /**
   * `true` once any planner reply in this run generated a task
   * breakdown via a `TASKS` artifact. NOTE: this is only the
   * artifact-derived fast-path — it is NOT what gates the **Start
   * Tasks** button. The planner can also create tasks over MCP
   * (`create_task` / `create_feature_task`), which produce no artifact
   * and leave this `false`. `SidebarChat` therefore renders
   * `StartTasksSlot` for any run that got a planner reply, and the slot
   * reads the live ready-count (`…/tasks/assign-all`) as the real,
   * artifact-independent source of truth. Starting tasks is the user's
   * call (it spins up real compute) — the canvas agent never does it.
   */
  hasGeneratedTasks?: boolean;
}

interface ToolCallOutput {
  status?: string;
  featureId?: string;
  featureTitle?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  awaitingReply?: boolean;
  error?: string;
  workflowStatus?: string;
}

interface ToolCallInput {
  featureId?: string;
  message?: string;
}

/**
 * Helper: ensure a `SubAgentRun` exists for `featureId`, creating
 * it with placeholder metadata if missing. Returns the run so the
 * caller can push entries and update the anchor.
 */
function upsertRun(
  byFeature: Map<string, SubAgentRun>,
  featureId: string,
  seed: { featureTitle?: string; workspaceSlug?: string; workspaceName?: string },
): SubAgentRun {
  const existing = byFeature.get(featureId);
  if (existing) {
    if (
      existing.featureTitle === "Unknown feature" &&
      seed.featureTitle &&
      seed.featureTitle !== "Unknown feature"
    ) {
      existing.featureTitle = seed.featureTitle;
    }
    if (!existing.workspaceSlug && seed.workspaceSlug) {
      existing.workspaceSlug = seed.workspaceSlug;
    }
    if (!existing.workspaceName && seed.workspaceName) {
      existing.workspaceName = seed.workspaceName;
    }
    return existing;
  }
  const created: SubAgentRun = {
    featureId,
    featureTitle: seed.featureTitle ?? "Unknown feature",
    workspaceSlug: seed.workspaceSlug ?? "",
    workspaceName: seed.workspaceName ?? "",
    messages: [],
    anchorMessageId: "",
  };
  byFeature.set(featureId, created);
  return created;
}

/**
 * Walk the conversation, find all entries that belong to a planner
 * conversation thread, and group them by `featureId`. Each group
 * becomes one `SubAgentRun` that `SidebarChat` will render as a
 * single card.
 *
 * Two entry sources:
 *   - **Outbound** (`direction: "out"`): canvas-agent tool calls to
 *     `send_to_feature_planner`. Read from `message.toolCalls[]`.
 *     Tool calls without a resolvable `featureId` are skipped.
 *   - **Inbound** (`direction: "in"`): fan-out rows the canvas-
 *     planner-fanout worker wrote into this conversation, marked
 *     with `source: { kind: "planner", featureId, plannerMessageId }`.
 *     Read directly from `message.source`.
 *
 * Sort order is overall-conversation chronological — both sources
 * share the same `messageIndex` axis.
 */
export function getSubAgentRunsFromMessages(
  messages: CanvasChatMessage[],
): SubAgentRun[] {
  const byFeature = new Map<string, SubAgentRun>();
  // Planner message ids the user has answered via `PlannerFormSlot`
  // (a `user-answered-planner-form` row). Used after the walk to
  // decide which inbound FORM is still pending.
  const answeredPlannerMessageIds = new Set<string>();

  messages.forEach((message, messageIndex) => {
    // ── Inbound: planner → canvas (fan-out row) ────────────────
    if (message.source?.kind === "planner") {
      const { featureId } = message.source;
      // Seed feature display metadata from the inbound row so an
      // inbound-only run (approval flow — no outbound tool call to carry
      // it) still shows the real name / workspace / plan link.
      const run = upsertRun(byFeature, featureId, {
        featureTitle: message.source.featureTitle,
        workspaceSlug: message.source.workspaceSlug,
        workspaceName: message.source.workspaceName,
      });
      run.messages.push({
        messageId: message.id,
        messageIndex,
        direction: "in",
        text: message.content,
        status: "sent",
        workflowStatus: message.source.workflowStatus,
        hasForm: message.source.hasForm,
        plannerMessageId: message.source.plannerMessageId,
        formQuestions: message.source.formQuestions,
        hasTasks: message.source.hasTasks,
      });
      // Inbound entries also move the anchor — a planner reply is
      // the freshest activity for this feature, so the card should
      // hang under it.
      run.anchorMessageId = message.id;
      // Don't fall through to the toolCalls walk: a planner-source
      // row should never carry a `send_to_feature_planner` tool call.
      return;
    }

    // ── User answered a planner FORM in canvas chat (Phase 4) ──
    if (message.source?.kind === "user-answered-planner-form") {
      const { featureId, plannerMessageId } = message.source;
      answeredPlannerMessageIds.add(plannerMessageId);
      const run = upsertRun(byFeature, featureId, {});
      run.messages.push({
        messageId: message.id,
        messageIndex,
        direction: "out",
        formAnswer: true,
        text: message.content,
        status: "sent",
      });
      run.anchorMessageId = message.id;
      return;
    }

    // ── Outbound: canvas agent → planner (tool call) ───────────
    if (!message.toolCalls?.length) return;

    for (const tc of message.toolCalls) {
      if (tc.toolName !== SEND_TO_FEATURE_PLANNER_TOOL) continue;

      const input = (tc.input ?? {}) as ToolCallInput;
      const output = (tc.output ?? {}) as ToolCallOutput;

      // The featureId on `input` is the agent's intent; `output`
      // echoes it back on success and on the IN_PROGRESS guard.
      // Either source is fine — prefer input so we still render a
      // card if the tool threw before returning.
      const featureId = input.featureId ?? output.featureId;
      if (!featureId) continue;

      // For the card title / link we need the workspace + feature
      // metadata. Output carries it for success and the IN_PROGRESS
      // error path. Early-error tool failures (feature-not-found,
      // cross-org reject) won't have it — we render with placeholder
      // strings so the user still sees that an attempt was made.
      const run = upsertRun(byFeature, featureId, {
        featureTitle: output.featureTitle,
        workspaceSlug: output.workspaceSlug,
        workspaceName: output.workspaceName,
      });

      const runStatus = deriveRunStatus(tc.status, output);
      run.messages.push({
        messageId: message.id,
        messageIndex,
        direction: "out",
        text: input.message ?? "",
        status: runStatus,
        errorReason:
          runStatus === "failed"
            ? output.error ?? tc.errorText ?? undefined
            : undefined,
      });
      // We iterate the conversation chronologically, so every new
      // push is by definition the most recent send for this
      // feature → it becomes the new anchor (the chat-scroll
      // position the card hangs under).
      run.anchorMessageId = message.id;
    }
  });

  // Phase 4: resolve each run's pending FORM — the most recent inbound
  // entry that carries `formQuestions` and hasn't been answered yet.
  // Walk newest→oldest so the *latest* unanswered FORM wins (a planner
  // that re-asked supersedes an earlier question).
  for (const run of byFeature.values()) {
    // Tasks-generated is sticky: once any planner reply carried a TASKS
    // artifact, the Start Tasks affordance stays available (the slot
    // itself reads the live ready-count and hides when none remain).
    run.hasGeneratedTasks = run.messages.some(
      (m) => m.direction === "in" && m.hasTasks === true,
    );

    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i];
      if (m.direction !== "in" || !m.formQuestions?.length) continue;
      if (m.plannerMessageId && answeredPlannerMessageIds.has(m.plannerMessageId)) {
        // This FORM was answered; an older one can't be "pending" once
        // a newer message exists, so stop at the newest FORM regardless.
        break;
      }
      run.pendingForm = {
        plannerMessageId: m.plannerMessageId ?? m.messageId,
        questions: m.formQuestions,
      };
      break;
    }
  }

  // Filter out any run that ended up with no anchor (shouldn't
  // happen in practice — every push sets an anchor — but defensive
  // against future code paths that pre-create a run).
  return Array.from(byFeature.values()).filter((r) => r.anchorMessageId);
}

/**
 * Project the AI SDK's tool-call `status` field + our structured
 * output into a UI-friendly three-state. AI SDK statuses we care
 * about: `"input-streaming"`, `"input-available"`, `"output-available"`,
 * `"output-error"`. Anything that hasn't yielded output yet → in-flight;
 * any output with `error` or `errorText` → failed.
 */
function deriveRunStatus(
  toolCallStatus: string,
  output: ToolCallOutput,
): RunMessage["status"] {
  if (output.error) return "failed";
  if (toolCallStatus === "output-error") return "failed";
  // Any other resolved state = the tool body returned `{ status: "sent" }`.
  // In-flight covers `input-streaming` / `input-available` and any
  // pre-resolution state from the AI SDK.
  if (toolCallStatus === "output-available") return "sent";
  return "in_flight";
}

/**
 * The card's headline status — a label plus a `tone` that selects the
 * pill color + icon. Derived from the run's latest thread entry:
 *
 *   - **Outbound latest** (canvas agent → planner, no reply yet): the
 *     send is still in flight / failed / delivered-and-waiting.
 *   - **Inbound latest** (planner → canvas): a `FORM` means the planner
 *     needs the user (`waiting`); otherwise the planner's
 *     `workflowStatus` tells us whether it's still running, done, or
 *     broken.
 *
 * `tone` is intentionally a small closed set so the pill/icon mapping
 * stays exhaustive.
 */
type CardTone = "running" | "waiting" | "failed" | "replied" | "sent";

interface CardStatus {
  label: string;
  tone: CardTone;
}

export function deriveCardStatus(run: SubAgentRun): CardStatus {
  // Run-level: an unanswered planner FORM always wins — it's the one
  // state that demands the user's hands (Phase 4). Even if a later
  // prose message arrived, the FORM is still pending until answered.
  if (run.pendingForm) return { label: "Waiting for you", tone: "waiting" };

  const latest = run.messages[run.messages.length - 1];
  if (!latest) return { label: "Sent · waiting for reply", tone: "sent" };

  if (latest.direction === "out") {
    if (latest.formAnswer)
      return { label: "Answered · waiting for planner", tone: "sent" };
    if (latest.status === "failed") return { label: "Failed", tone: "failed" };
    if (latest.status === "in_flight")
      return { label: "Sending…", tone: "running" };
    return run.messages.length > 1
      ? { label: `${run.messages.length} messages sent · waiting`, tone: "sent" }
      : { label: "Sent · waiting for reply", tone: "sent" };
  }

  // Inbound (planner → canvas).
  if (latest.hasForm) return { label: "Waiting for you", tone: "waiting" };

  switch (latest.workflowStatus) {
    case "IN_PROGRESS":
      return { label: "Running", tone: "running" };
    case "COMPLETED":
      return { label: "Plan ready", tone: "replied" };
    case "FAILED":
    case "ERROR":
    case "HALTED":
      return { label: "Needs attention", tone: "failed" };
    default:
      return { label: "Replied", tone: "replied" };
  }
}

/** Tailwind classes for the pill, keyed by tone. */
const TONE_PILL_CLASSES: Record<CardTone, string> = {
  running:
    "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  waiting:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30",
  failed:
    "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
  replied:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  sent: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

function StatusIconForTone({ tone }: { tone: CardTone }) {
  switch (tone) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />;
    case "waiting":
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-rose-500" />;
    case "replied":
      return <Check className="h-3.5 w-3.5 text-emerald-500" />;
    case "sent":
      return <Send className="h-3.5 w-3.5 text-sky-500" />;
  }
}

function StatusPill({ status }: { status: CardStatus }) {
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_PILL_CLASSES[status.tone]}`}
    >
      {status.label}
    </span>
  );
}

/**
 * The text to show for a thread entry. Planner replies often carry no
 * prose — the payload is a clarifying-questions FORM or a TASKS
 * breakdown artifact, not message text — so a bare "(empty)" reads as a
 * bug. Describe what the planner actually did instead. Outbound sends
 * keep the literal "(empty)" (a content-less send is genuinely odd).
 */
function runMessageDisplayText(m: RunMessage): string {
  if (m.text.trim()) return m.text;
  if (m.direction === "in") {
    if (m.hasForm) return "Asked a clarifying question";
    if (m.hasTasks) return "Generated a task breakdown";
    if (m.workflowStatus === "COMPLETED") return "Posted the plan";
    return "Posted an update";
  }
  if (m.formAnswer) return "Answered";
  return "(empty)";
}

interface SubAgentRunCardProps {
  run: SubAgentRun;
}

export function SubAgentRunCard({ run }: SubAgentRunCardProps) {
  // Default-collapsed per the canvas-agent-manages-planners plan
  // (Phase 1). One card per managed feature, persistent for the
  // lifetime of the conversation; collapsed shows just one line.
  // Click the header anywhere except the "Open feature" link to
  // toggle. Phases 2-4 extend this idiom (inbound thread entries,
  // meaningful status pill, FORM artifact surfacing outside the
  // collapse); the shape is established here.
  const [collapsed, setCollapsed] = useState(true);

  const planHref =
    run.workspaceSlug && run.featureId
      ? `/w/${run.workspaceSlug}/plan/${run.featureId}`
      : null;

  // Phase 3: a single derived status drives both the headline copy and
  // the colored pill / icon. Replaces the Phase 2 direction-only
  // headline; now `Running` / `Waiting for you` / `Plan ready` /
  // `Needs attention` materialize from the inbound planner message's
  // `workflowStatus` + `hasForm` signals carried through the fan-out.
  const status = deriveCardStatus(run);
  const StatusIcon = <StatusIconForTone tone={status.tone} />;

  const Chevron = collapsed ? (
    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
  );

  return (
    <div
      data-feature-id={run.featureId}
      className="rounded-lg border bg-card text-card-foreground"
    >
      {/*
        Header is a button so the whole row is keyboard-toggleable.
        The "Open feature" link is a sibling, not a child, so its
        click doesn't bubble into the toggle. We still stop
        propagation defensively in case the link is restructured.
      */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="mt-0.5 flex-shrink-0">{Chevron}</div>
        <div className="mt-0.5 flex-shrink-0">{StatusIcon}</div>
        <div className="min-w-0 flex-1">
          {collapsed ? (
            // Collapsed: single line — feature · workspace · status.
            <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className="min-w-0 truncate font-medium">
                {run.featureTitle}
              </span>
              {run.workspaceName && (
                <>
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground"
                  >
                    ·
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {run.workspaceName}
                  </span>
                </>
              )}
              <span
                aria-hidden="true"
                className="text-muted-foreground"
              >
                ·
              </span>
              <StatusPill status={status} />
            </div>
          ) : (
            // Expanded: the original card chrome (eyebrow + title +
            // thread + status footer).
            <>
              <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="font-medium">Feature planner</span>
                {run.workspaceName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{run.workspaceName}</span>
                  </>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1 break-words text-sm font-medium">
                <span className="min-w-0 truncate">{run.featureTitle}</span>
                {planHref && (
                  <a
                    href={planHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex flex-shrink-0 items-center text-muted-foreground hover:text-foreground"
                    title="Open feature plan"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {/*
                Thread — three entry classes, in conversation-
                chronological order:
                  - canvas-agent → planner send (→, muted italic)
                  - planner → canvas reply (←, foreground)
                  - user answered a planner FORM (✓, emerald) — Phase 4
                The marker makes direction/kind obvious at a glance.
              */}
              <ul className="mt-1.5 space-y-1">
                {run.messages.map((m, i) => {
                  const isInbound = m.direction === "in";
                  const isFormAnswer = m.formAnswer === true;
                  return (
                    <li
                      key={`${m.messageId}-${i}`}
                      className={
                        isInbound
                          ? "flex items-start gap-1.5 text-xs text-foreground/80"
                          : "flex items-start gap-1.5 text-xs text-muted-foreground"
                      }
                    >
                      <span
                        className={
                          isInbound || isFormAnswer
                            ? "mt-[3px] flex-shrink-0 text-emerald-600 dark:text-emerald-400"
                            : "mt-[3px] flex-shrink-0 text-foreground/60"
                        }
                        aria-hidden="true"
                      >
                        {isInbound ? "←" : isFormAnswer ? "✓" : "→"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span
                          className={
                            isInbound || isFormAnswer
                              ? "break-words"
                              : "break-words italic"
                          }
                        >
                          {isInbound || isFormAnswer
                            ? runMessageDisplayText(m)
                            : `\u201C${runMessageDisplayText(m)}\u201D`}
                        </span>
                        {m.status === "failed" && m.errorReason && (
                          <span className="ml-1 not-italic text-rose-600 dark:text-rose-400">
                            — {m.errorReason}
                          </span>
                        )}
                        {/*
                          Delivered checkmark on outbound entries
                          that have something — anything — after
                          them in the thread (a subsequent send OR
                          a planner reply). The latest outbound
                          stays without the check until either case
                          is satisfied.
                        */}
                        {!isInbound &&
                          !isFormAnswer &&
                          m.status === "sent" &&
                          i < run.messages.length - 1 && (
                            <Check
                              className="ml-1 inline h-3 w-3 text-emerald-600 dark:text-emerald-400"
                              aria-label="Delivered"
                            />
                          )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-1.5">
                <StatusPill status={status} />
              </div>
            </>
          )}
        </div>
      </button>

      {/*
        "View plan" lives OUTSIDE the header <button> (no nested buttons)
        and only when expanded — `FeaturePlanDialog` lazily fetches the
        feature on mount and self-hides until a plan part exists.
      */}
      {!collapsed && (
        <FeaturePlanDialog
          featureId={run.featureId}
          featureTitle={run.featureTitle}
        />
      )}
    </div>
  );
}
