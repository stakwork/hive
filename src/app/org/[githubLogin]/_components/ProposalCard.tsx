"use client";

import { useMemo, useState } from "react";
import { Check, X, ExternalLink, Loader2, Lightbulb } from "lucide-react";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  getProposalStatus,
  type ApprovalIntent,
  type ProposalOutput,
  type FeatureProposalPayload,
  type InitiativeProposalPayload,
} from "@/lib/proposals/types";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";

/**
 * Renders a single agent proposal as an inline card with Approve / Reject
 * controls. The proposal itself is a tool-call output — proposals are
 * not stored as DB rows, they're just chat metadata. Status (pending /
 * pending-in-flight / approved / rejected) is **derived** from the
 * conversation transcript by scanning for matching `approval` /
 * `rejection` / `approvalResult` fields on later messages.
 *
 * Rendering rules:
 *   - pending: full color, ✓/✗ buttons enabled.
 *   - pending-in-flight: ✓/✗ disabled, spinner.
 *   - approved: dimmed, "Created on this canvas ✓" / "Created on X ↗"
 *     subtext (the latter linking via `?canvas=<landedOn>`).
 *   - rejected: faded, "Rejected" subtext.
 *
 * Inline-edit (planned but minimal in v1): the card optimistically
 * carries an editable `payload` override locally; on Approve we forward
 * it as `intent.payload`. The original tool-call output stays intact.
 */
interface ProposalCardProps {
  /** Tool call output the agent emitted. */
  proposal: ProposalOutput;
  /** The id of the message that emitted this proposal — used for
   *  per-card key/id stability and not much else today. */
  messageId: string;
  /** The github login of the org — used to resolve `landedOn` deep links. */
  githubLogin: string;
}

export function ProposalCard({
  proposal,
  messageId,
  githubLogin,
}: ProposalCardProps) {
  // Status comes from a conversation scan. We pull the full message
  // list once with a stable selector — re-renders only when the list
  // changes (new message appended), not on every text-delta of an
  // in-flight assistant turn.
  const activeId = useCanvasChatStore((s) => s.activeConversationId);
  const messages = useCanvasChatStore(
    (s) =>
      (activeId ? s.conversations[activeId]?.messages : undefined) ??
      EMPTY_MESSAGES,
  );
  const currentRef = useCanvasChatStore(
    (s) =>
      (activeId
        ? s.conversations[activeId]?.context.currentCanvasRef
        : "") ?? "",
  );

  const status = useMemo(
    () => getProposalStatus(messages, proposal.proposalId),
    [messages, proposal.proposalId],
  );

  const sendMessage = useSendCanvasChatMessage();

  // The card surfaces a single editable field per proposal: title /
  // name. Anything more invasive lives behind the future "edit" UI
  // — the v1 contract is "the agent should propose well; the user's
  // job is to accept / decline / lightly tweak."
  const initialTitle =
    proposal.kind === "initiative"
      ? proposal.payload.name
      : proposal.payload.title;
  const [editedTitle, setEditedTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);

  const isPending = status.status === "pending";
  const isInFlight = status.status === "pending-in-flight";
  const isApproved = status.status === "approved";
  const isRejected = status.status === "rejected";

  const handleApprove = async () => {
    if (!activeId || !isPending) return;
    const payload =
      editedTitle !== initialTitle
        ? proposal.kind === "initiative"
          ? ({ name: editedTitle } as Partial<InitiativeProposalPayload>)
          : ({ title: editedTitle } as Partial<FeatureProposalPayload>)
        : undefined;

    const intent: ApprovalIntent = {
      proposalId: proposal.proposalId,
      ...(payload && { payload }),
      currentRef: currentRef || "",
      // Viewport hint defaults to a static "near origin" point. Future
      // drag-from-chat will override this with drop coords; until then
      // the projector falls back to its auto-layout slot when the
      // overlay isn't legal anyway, so the value rarely matters.
      viewport: { x: 40, y: 40 },
    };

    await sendMessage({
      conversationId: activeId,
      content: `Approved: ${editedTitle}`,
      approval: intent,
    });
  };

  const handleReject = async () => {
    if (!activeId || !isPending) return;
    await sendMessage({
      conversationId: activeId,
      content: `Rejected: ${initialTitle}`,
      rejection: { proposalId: proposal.proposalId },
    });
  };

  // Subtext for approved state. Prefer the resolved entity name
  // ("Created on Auth Refactor") over the kind-only fallback ("Created
  // on the initiative canvas") when the approval handler was able to
  // look it up. Older approval results (from before `landedOnName` was
  // added) and the root canvas both legitimately omit the name and
  // fall through to `labelForRef`.
  const approvedSubtext = useMemo(() => {
    if (status.status !== "approved") return null;
    const r = status.result;
    const onCurrent = r.landedOn === currentRef;
    if (onCurrent) {
      return { text: "Created on this canvas", deepLink: null as string | null };
    }
    const label =
      r.landedOnName ??
      (r.landedOn === "" ? "the org canvas" : labelForRef(r.landedOn));
    const href =
      r.landedOn === ""
        ? `/org/${githubLogin}`
        : `/org/${githubLogin}?canvas=${encodeURIComponent(r.landedOn)}`;
    return { text: `Created on ${label}`, deepLink: href };
  }, [status, currentRef, githubLogin]);

  return (
    <div
      data-message-id={messageId}
      className={`rounded-lg border bg-card text-card-foreground transition-opacity ${
        isApproved || isRejected ? "opacity-60" : ""
      } ${isRejected ? "line-through decoration-1" : ""}`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="mt-0.5 flex-shrink-0">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-medium">
              Proposed {proposal.kind}
            </span>
          </div>
          {/* Title — inline-editable on click while pending */}
          {isPending && isEditing ? (
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setIsEditing(false);
                if (e.key === "Escape") {
                  setEditedTitle(initialTitle);
                  setIsEditing(false);
                }
              }}
              autoFocus
              className="mt-0.5 w-full rounded border bg-background px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <div
              className={`mt-0.5 break-words text-sm font-medium ${
                isPending ? "cursor-text" : ""
              }`}
              onClick={() => isPending && setIsEditing(true)}
            >
              {editedTitle}
            </div>
          )}
          {proposal.kind === "feature" && (
            <FeatureMeta payload={proposal.payload} />
          )}
          {proposal.rationale && (
            <div className="mt-1 text-xs text-muted-foreground italic">
              {proposal.rationale}
            </div>
          )}
          {isApproved && approvedSubtext && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              <span>{approvedSubtext.text}</span>
              {approvedSubtext.deepLink && (
                <a
                  href={approvedSubtext.deepLink}
                  className="inline-flex items-center hover:underline"
                  title="Open"
                >
                  <ExternalLink className="ml-0.5 h-3 w-3" />
                </a>
              )}
            </div>
          )}
          {isRejected && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Rejected
            </div>
          )}
        </div>

        {/* Action buttons */}
        {(isPending || isInFlight) && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleApprove}
              disabled={!isPending || isInFlight}
              title="Approve"
              className="flex h-6 w-6 items-center justify-center rounded text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
            >
              {isInFlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={!isPending || isInFlight}
              title="Reject"
              className="flex h-6 w-6 items-center justify-center rounded text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureMeta({ payload }: { payload: FeatureProposalPayload }) {
  // Compact secondary line. Keeps card height predictable; full
  // workspace name resolution would require another store lookup,
  // so we surface the raw cuid suffix as a stable hint instead.
  const parts: string[] = [];
  if (payload.workspaceId) parts.push(`ws ${shortId(payload.workspaceId)}`);
  if (payload.initiativeId)
    parts.push(`init ${shortId(payload.initiativeId)}`);
  else if (payload.parentProposalId) parts.push("under proposed initiative");
  if (payload.milestoneId) parts.push(`milestone ${shortId(payload.milestoneId)}`);
  if (parts.length === 0) return null;
  return (
    <div className="mt-0.5 text-[11px] text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id;
}

function labelForRef(ref: string): string {
  if (ref.startsWith("ws:")) return "the workspace canvas";
  if (ref.startsWith("initiative:")) return "the initiative canvas";
  // Defensive: pre-cutover proposal trails may still carry
  // `milestone:<id>` refs even though milestones aren't drillable
  // scopes today (their cards live on the parent initiative canvas).
  if (ref.startsWith("milestone:")) return "the initiative canvas";
  return "another canvas";
}

const EMPTY_MESSAGES: CanvasChatMessage[] = [];

/**
 * Helper consumed by `SidebarChat` to extract proposal tool outputs
 * from a message's `toolCalls` array. Returns the typed `ProposalOutput`
 * objects (skipping any tool errors that landed as `{ error: "..." }`).
 */
export function getProposalsFromMessage(
  message: CanvasChatMessage,
): ProposalOutput[] {
  if (!message.toolCalls?.length) return [];
  const out: ProposalOutput[] = [];
  for (const tc of message.toolCalls) {
    if (
      tc.toolName !== PROPOSE_INITIATIVE_TOOL &&
      tc.toolName !== PROPOSE_FEATURE_TOOL
    )
      continue;
    const o = tc.output;
    if (!o || typeof o !== "object") continue;
    if ("error" in o) continue;
    out.push(o as ProposalOutput);
  }
  return out;
}
