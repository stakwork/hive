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
  /** The id of the canvas-chat message that emitted this tool call. */
  messageId: string;
  /** The position in the overall conversation; lets us sort runs by recency. */
  messageIndex: number;
  /** The message body the canvas agent passed via `message` input. */
  text: string;
  /** Outcome of this individual send. */
  status: "sent" | "in_flight" | "failed";
  /** Failure reason for "failed" status. Optional for "sent" / "in_flight". */
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
 * Walk the conversation, find all `send_to_feature_planner` tool
 * calls, and group them by `featureId`. Each group becomes one
 * `SubAgentRun` that `SidebarChat` will render as a single card.
 *
 * Tool calls without a resolvable `featureId` (malformed input, or
 * an error so early the feature lookup didn't happen) are skipped —
 * we can't render a card without knowing which planner the agent
 * meant.
 */
export function getSubAgentRunsFromMessages(
  messages: CanvasChatMessage[],
): SubAgentRun[] {
  const byFeature = new Map<string, SubAgentRun>();

  messages.forEach((message, messageIndex) => {
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
      const featureTitle = output.featureTitle ?? "Unknown feature";
      const workspaceSlug = output.workspaceSlug ?? "";
      const workspaceName = output.workspaceName ?? "";

      const runStatus = deriveRunStatus(tc.status, output);
      const runMessage: RunMessage = {
        messageId: message.id,
        messageIndex,
        text: input.message ?? "",
        status: runStatus,
        errorReason:
          runStatus === "failed"
            ? output.error ?? tc.errorText ?? undefined
            : undefined,
      };

      const existing = byFeature.get(featureId);
      if (existing) {
        existing.messages.push(runMessage);
        // We iterate the conversation chronologically, so every new
        // push is by definition the most recent send for this
        // feature → it becomes the new anchor (the chat-scroll
        // position the card hangs under).
        existing.anchorMessageId = message.id;
        // Prefer non-placeholder metadata when later calls have it
        // (e.g. an early call failed before lookup, a later one
        // succeeded — use the success's metadata for the card).
        if (existing.featureTitle === "Unknown feature" && output.featureTitle) {
          existing.featureTitle = output.featureTitle;
        }
        if (!existing.workspaceSlug && workspaceSlug) {
          existing.workspaceSlug = workspaceSlug;
        }
        if (!existing.workspaceName && workspaceName) {
          existing.workspaceName = workspaceName;
        }
      } else {
        byFeature.set(featureId, {
          featureId,
          featureTitle,
          workspaceSlug,
          workspaceName,
          messages: [runMessage],
          anchorMessageId: message.id,
        });
      }
    }
  });

  return Array.from(byFeature.values());
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
  const planHref =
    run.workspaceSlug && run.featureId
      ? `/w/${run.workspaceSlug}/plan/${run.featureId}`
      : null;

  // Headline status copy. We deliberately don't say "replied" yet —
  // the canvas agent doesn't poll, and showing "waiting" until the
  // next `read_feature` is honest. Phase 2 extends this with inbound
  // planner messages, at which point `replied` / `waiting for you`
  // become meaningful.
  const headlineStatus =
    latestStatus === "failed"
      ? "Failed"
      : latestStatus === "in_flight"
        ? "Sending..."
        : run.messages.length > 1
          ? `${run.messages.length} messages sent · waiting`
          : "Sent · waiting for reply";

  const StatusIcon =
    latestStatus === "in_flight" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
    ) : latestStatus === "failed" ? (
      <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
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

              {/* Thread — each canvas-agent → planner message in order. */}
              <ul className="mt-1.5 space-y-1">
                {run.messages.map((m, i) => (
                  <li
                    key={`${m.messageId}-${i}`}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="mt-[3px] flex-shrink-0 text-foreground/60"
                      aria-hidden="true"
                    >
                      →
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="break-words italic">
                        &ldquo;{m.text || "(empty)"}&rdquo;
                      </span>
                      {m.status === "failed" && m.errorReason && (
                        <span className="ml-1 not-italic text-rose-600 dark:text-rose-400">
                          — {m.errorReason}
                        </span>
                      )}
                      {m.status === "sent" && i < run.messages.length - 1 && (
                        <Check
                          className="ml-1 inline h-3 w-3 text-emerald-600 dark:text-emerald-400"
                          aria-label="Delivered"
                        />
                      )}
                    </div>
                  </li>
                ))}
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
