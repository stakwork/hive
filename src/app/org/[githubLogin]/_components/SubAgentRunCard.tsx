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
   *     tool call).
   *   - `"in"`: planner → canvas (a fan-out row carrying
   *     `source: { kind: "planner", ... }`, written by
   *     `fanOutPlannerMessageToCanvas`).
   */
  direction: "out" | "in";
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

  messages.forEach((message, messageIndex) => {
    // ── Inbound: planner → canvas (fan-out row) ────────────────
    if (message.source?.kind === "planner") {
      const { featureId } = message.source;
      const run = upsertRun(byFeature, featureId, {});
      run.messages.push({
        messageId: message.id,
        messageIndex,
        direction: "in",
        text: message.content,
        status: "sent",
      });
      // Inbound entries also move the anchor — a planner reply is
      // the freshest activity for this feature, so the card should
      // hang under it.
      run.anchorMessageId = message.id;
      // Don't fall through to the toolCalls walk: a planner-source
      // row should never carry a `send_to_feature_planner` tool call.
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

  const latest = run.messages[run.messages.length - 1];
  const latestStatus = latest?.status ?? "sent";
  const latestDirection = latest?.direction ?? "out";
  const planHref =
    run.workspaceSlug && run.featureId
      ? `/w/${run.workspaceSlug}/plan/${run.featureId}`
      : null;

  // Headline status copy. With Phase 2 we now see inbound planner
  // messages too, so the headline can finally say "Replied" when the
  // last entry is from the planner. Phase 3 will refine further
  // (FORM artifacts → "Waiting for you"; workflow transitions →
  // "Plan ready"); Phase 2 keeps it to the three states the data
  // can support today.
  const headlineStatus =
    latestStatus === "failed"
      ? "Failed"
      : latestStatus === "in_flight"
        ? "Sending..."
        : latestDirection === "in"
          ? "Replied"
          : run.messages.length > 1
            ? `${run.messages.length} messages sent · waiting`
            : "Sent · waiting for reply";

  const StatusIcon =
    latestStatus === "in_flight" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
    ) : latestStatus === "failed" ? (
      <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
    ) : latestDirection === "in" ? (
      <Check className="h-3.5 w-3.5 text-emerald-500" />
    ) : (
      <Send className="h-3.5 w-3.5 text-sky-500" />
    );

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
              <span className="flex-shrink-0 truncate text-xs text-muted-foreground">
                {headlineStatus}
              </span>
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
                Thread — canvas-agent → planner (→) and planner →
                canvas (←) messages, in conversation-chronological
                order. The arrow makes direction obvious; inbound
                entries use the foreground text color (not muted)
                because they're "fresh content the planner wrote"
                and visually distinct from the canvas-agent's own
                outbound sends.
              */}
              <ul className="mt-1.5 space-y-1">
                {run.messages.map((m, i) => {
                  const isInbound = m.direction === "in";
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
                          isInbound
                            ? "mt-[3px] flex-shrink-0 text-emerald-600 dark:text-emerald-400"
                            : "mt-[3px] flex-shrink-0 text-foreground/60"
                        }
                        aria-hidden="true"
                      >
                        {isInbound ? "←" : "→"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span
                          className={
                            isInbound
                              ? "break-words"
                              : "break-words italic"
                          }
                        >
                          {isInbound
                            ? m.text || "(empty)"
                            : `\u201C${m.text || "(empty)"}\u201D`}
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

              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {headlineStatus}
              </div>
            </>
          )}
        </div>
      </button>
    </div>
  );
}
