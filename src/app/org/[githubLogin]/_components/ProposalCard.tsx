"use client";

import React, { useMemo, useState } from "react";
import {
  Check,
  X,
  ExternalLink,
  Loader2,
  Lightbulb,
  Info,
  FileDiff,
} from "lucide-react";
import { computeUnifiedDiff, type UnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import { Switch } from "@/components/ui/switch";
import ReactMarkdown from "react-markdown";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  PROPOSE_NEW_PROMPT_TOOL,
  PROPOSE_PROMPT_UPDATE_TOOL,
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
  getProposalStatus,
  type ApprovalIntent,
  type ProposalOutput,
  type FeatureProposalMeta,
  type FeatureProposalPayload,
  type InitiativeProposalPayload,
  type MilestoneProposalPayload,
} from "@/lib/proposals/types";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

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
  // Milestone proposals additionally expose a feature checklist (see
  // below); checked ids ride along on the approval intent's
  // `featureIds` override.
  const initialTitle =
    proposal.kind === "initiative"
      ? proposal.payload.name
      : proposal.kind === "milestone"
        ? proposal.payload.name
        : proposal.kind === "promptCreate"
          ? proposal.payload.name
          : proposal.kind === "promptUpdate"
            ? (proposal.meta.promptName ?? proposal.payload.promptId)
            : proposal.kind === "conceptCreate"
              ? proposal.payload.name
              : proposal.kind === "conceptUpdate"
                ? (proposal.meta.conceptName ?? proposal.payload.conceptId)
                : proposal.payload.title;
  const [editedTitle, setEditedTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);
  // Prompt/concept proposals forward no inline-edit override (handleApprove
  // sets payload = undefined for them), so an editable title would be a lie —
  // the name/id shown is fixed. Only roadmap kinds get the click-to-edit.
  const titleEditable =
    proposal.kind !== "promptCreate" &&
    proposal.kind !== "promptUpdate" &&
    proposal.kind !== "conceptCreate" &&
    proposal.kind !== "conceptUpdate";

  // Feature-only: per-feature auto-respond toggle.
  // Initialized from the proposal payload (which is seeded from the
  // user's global `canvasAutonomousTurns` preference at propose time).
  const [autoRespond, setAutoRespond] = useState<boolean>(
    proposal.kind === "feature" ? (proposal.payload.autoRespond ?? false) : false,
  );

  // Milestone-only: which features are currently checked for attach.
  // Initialized from `proposal.payload.featureIds` (the agent's
  // suggestion). The user can uncheck/re-check before approving;
  // the post-toggle list goes into `intent.payload.featureIds` as a
  // full replacement (matching how `name` replaces, not merges).
  const initialFeatureIds = useMemo(
    () =>
      proposal.kind === "milestone" ? proposal.payload.featureIds : [],
    [proposal],
  );
  const [checkedFeatureIds, setCheckedFeatureIds] = useState<string[]>(
    initialFeatureIds,
  );

  // Details dialog state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = useMemo(() => proposalHasDetails(proposal), [proposal]);

  const isPending = status.status === "pending";
  const isInFlight = status.status === "pending-in-flight";
  const isApproved = status.status === "approved";
  const isRejected = status.status === "rejected";

  // Disabled when any in-batch or cross-message blocker is not yet approved.
  const allBlockersApproved = useMemo(() => {
    if (proposal.kind !== "feature") return true;
    const blockerIds = proposal.payload.dependsOnProposalIds;
    if (!blockerIds?.length) return true;
    return blockerIds.every(
      (id) => getProposalStatus(messages, id).status === "approved",
    );
  }, [messages, proposal]);

  const handleApprove = async () => {
    if (!activeId || !isPending) return;

    // Build the payload override. We only forward fields the user
    // actually changed; an unchanged title or unchanged feature list
    // is dropped so the original proposal payload is used verbatim.
    let payload:
      | Partial<InitiativeProposalPayload>
      | Partial<FeatureProposalPayload>
      | Partial<MilestoneProposalPayload>
      | undefined;

    if (proposal.kind === "initiative") {
      if (editedTitle !== initialTitle) {
        payload = { name: editedTitle } as Partial<InitiativeProposalPayload>;
      }
    } else if (proposal.kind === "feature") {
      // autoRespond is always forwarded (unconditionally) so `false` is
      // never silently dropped — the server must receive an explicit value.
      payload = {
        ...(editedTitle !== initialTitle && { title: editedTitle }),
        autoRespond,
      } as Partial<FeatureProposalPayload>;
    } else if (
      proposal.kind === "promptCreate" ||
      proposal.kind === "promptUpdate" ||
      proposal.kind === "conceptCreate" ||
      proposal.kind === "conceptUpdate"
    ) {
      // Prompt/concept proposals have no inline-edit overrides in v1 — the
      // agent should propose well; the user's only action is approve/reject.
      // No viewport / editedTitle / checkedFeatureIds logic applies.
      payload = undefined;
    } else {
      const titleChanged = editedTitle !== initialTitle;
      const featuresChanged =
        checkedFeatureIds.length !== initialFeatureIds.length ||
        checkedFeatureIds.some((id, i) => id !== initialFeatureIds[i]);
      if (titleChanged || featuresChanged) {
        payload = {
          ...(titleChanged && { name: editedTitle }),
          ...(featuresChanged && { featureIds: checkedFeatureIds }),
        } as Partial<MilestoneProposalPayload>;
      }
    }

    // Read the live canvas viewport from the store (safe to call outside
    // React render — this is a click handler). Compute canvas-space bounds:
    //   canvasX = -vpX / zoom  (left edge of visible area in canvas coords)
    //   canvasY = -vpY / zoom  (top edge)
    //   canvasW = containerW / zoom  (visible width in canvas coords)
    //   canvasH = containerH / zoom  (visible height in canvas coords)
    const cv = useCanvasChatStore.getState().canvasViewport;
    const viewportState =
      cv && cv.zoom > 0
        ? {
            canvasX: -cv.x / cv.zoom,
            canvasY: -cv.y / cv.zoom,
            canvasW: cv.containerW / cv.zoom,
            canvasH: cv.containerH / cv.zoom,
          }
        : undefined;

    const intent: ApprovalIntent = {
      proposalId: proposal.proposalId,
      ...(payload && { payload }),
      currentRef: currentRef || "",
      // Legacy safety-net fallback for the server (used when viewportState
      // is absent or findFreeSlotInViewport returns null on a packed canvas).
      viewport: { x: 40, y: 40 },
      ...(viewportState && { viewportState }),
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

    // Feature approvals always link to the feature plan page.
    if (r.kind === "feature" && r.createdEntityId && r.workspaceSlug) {
      const onCurrent = r.landedOn === currentRef;
      const text = onCurrent
        ? "Created on this canvas"
        : `Created on ${r.landedOnName ?? (r.landedOn === "" ? "the org canvas" : labelForRef(r.landedOn))}`;
      return {
        text,
        deepLink: `/w/${r.workspaceSlug}/plan/${r.createdEntityId}` as string | null,
        newTab: true,
      };
    }

    // Feature approval without slug (older result) — text only, no link.
    if (r.kind === "feature") {
      const onCurrent = r.landedOn === currentRef;
      const text = onCurrent
        ? "Created on this canvas"
        : `Created on ${r.landedOnName ?? (r.landedOn === "" ? "the org canvas" : labelForRef(r.landedOn))}`;
      return { text, deepLink: null as string | null, newTab: false };
    }

    // Prompt approvals have no canvas deep-link — just a confirmation.
    if (r.kind === "promptCreate") {
      return { text: "Prompt created ✓", deepLink: null as string | null, newTab: false };
    }
    if (r.kind === "promptUpdate") {
      return { text: "New draft version saved ✓", deepLink: null as string | null, newTab: false };
    }

    // Concept approvals deep-link to the concept in the workspace learn UI
    // (when we know the slug + concept id).
    if (r.kind === "conceptCreate" || r.kind === "conceptUpdate") {
      const text =
        r.kind === "conceptCreate"
          ? "Concept created ✓"
          : "Documentation updated ✓";
      const deepLink =
        r.workspaceSlug && r.createdEntityId
          ? `/w/${r.workspaceSlug}/learn?concept=${encodeURIComponent(r.createdEntityId)}`
          : null;
      return { text, deepLink: deepLink as string | null, newTab: true };
    }

    // Initiative / milestone: keep existing behavior unchanged.
    const onCurrent = r.landedOn === currentRef;
    if (onCurrent) {
      return { text: "Created on this canvas", deepLink: null as string | null, newTab: false };
    }
    const label =
      r.landedOnName ??
      (r.landedOn === "" ? "the org canvas" : labelForRef(r.landedOn));
    const href =
      r.landedOn === ""
        ? `/org/${githubLogin}`
        : `/org/${githubLogin}?canvas=${encodeURIComponent(r.landedOn)}`;
    return { text: `Created on ${label}`, deepLink: href, newTab: false };
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
              {proposal.kind === "promptCreate"
                ? "Proposed New Prompt"
                : proposal.kind === "promptUpdate"
                  ? "Proposed Prompt Update"
                  : proposal.kind === "conceptCreate"
                    ? "Proposed New Concept"
                    : proposal.kind === "conceptUpdate"
                      ? "Proposed Concept Update"
                      : `Proposed ${proposal.kind}`}
            </span>
          </div>
          {/* Title — inline-editable on click while pending (roadmap kinds only) */}
          {isPending && isEditing && titleEditable ? (
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
                isPending && titleEditable ? "cursor-text" : ""
              }`}
              onClick={() => isPending && titleEditable && setIsEditing(true)}
            >
              {editedTitle}
            </div>
          )}
          {proposal.kind === "feature" && (
            <FeatureMeta payload={proposal.payload} meta={proposal.meta} />
          )}
          {proposal.kind === "milestone" && (
            <MilestoneMeta
              proposal={proposal}
              checkedIds={checkedFeatureIds}
              onToggle={(id) =>
                setCheckedFeatureIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id],
                )
              }
              isPending={isPending}
            />
          )}
          {proposal.kind === "promptCreate" && (
            <PromptCreateMeta payload={proposal.payload} />
          )}
          {proposal.kind === "promptUpdate" && (
            <PromptUpdateMeta meta={proposal.meta} />
          )}
          {proposal.kind === "conceptCreate" && (
            <ConceptCreateMeta payload={proposal.payload} meta={proposal.meta} />
          )}
          {proposal.kind === "conceptUpdate" && (
            <ConceptUpdateMeta meta={proposal.meta} />
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
                  {...(approvedSubtext.newTab && {
                    target: "_blank",
                    rel: "noopener noreferrer",
                  })}
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
          {/* Unified footer row: toggle (feature only) + icon buttons */}
          <div className="mt-1 flex items-center gap-1">
            {proposal.kind === "feature" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Auto-respond to planner
                </span>
                <Switch
                  checked={autoRespond}
                  onCheckedChange={setAutoRespond}
                  disabled={!isPending}
                  aria-label="Auto-respond to planner"
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              {hasDetails && (
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  title="Details"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              )}
              {(isPending || isInFlight) && (
                <>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={!isPending || isInFlight || !allBlockersApproved}
                    title={
                      !allBlockersApproved
                        ? "Approve blocking features first"
                        : "Approve"
                    }
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details dialog — rendered outside the flex row so it doesn't affect layout */}
      {hasDetails && (
        <ProposalDetailsDialog
          proposal={proposal}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
    </div>
  );
}

// ─── ProposalDetailsDialog ─────────────────────────────────────────────

interface ProposalDetailsDialogProps {
  proposal: ProposalOutput;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Section header style — consistent with "Features to attach" label in MilestoneMeta. */
const SECTION_LABEL_CLASS =
  "text-[10px] uppercase tracking-wide text-muted-foreground font-medium";

function ProposalDetailsDialog({
  proposal,
  open,
  onOpenChange,
}: ProposalDetailsDialogProps) {
  const kindLabel =
    proposal.kind === "initiative"
      ? "Initiative"
      : proposal.kind === "milestone"
        ? "Milestone"
        : proposal.kind === "promptCreate"
          ? "New Prompt"
          : proposal.kind === "promptUpdate"
            ? "Prompt Update"
            : proposal.kind === "conceptCreate"
              ? "New Concept"
              : proposal.kind === "conceptUpdate"
                ? "Concept Update"
                : "Feature";

  const title =
    proposal.kind === "initiative"
      ? proposal.payload.name
      : proposal.kind === "milestone"
        ? proposal.payload.name
        : proposal.kind === "promptCreate"
          ? proposal.payload.name
          : proposal.kind === "promptUpdate"
            ? (proposal.meta.promptName ?? proposal.payload.promptId)
            : proposal.kind === "conceptCreate"
              ? proposal.payload.name
              : proposal.kind === "conceptUpdate"
                ? (proposal.meta.conceptName ?? proposal.payload.conceptId)
                : proposal.payload.title;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <div className={SECTION_LABEL_CLASS}>{kindLabel} Proposal</div>
          <DialogTitle className="text-base min-w-0 break-words [overflow-wrap:anywhere]">{title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] min-w-0">
          <div className="px-5 py-4 space-y-4 min-w-0">
            {/* Description — kinds that carry one */}
            {"description" in proposal.payload && proposal.payload.description && (
              <div className="space-y-1">
                <div className={SECTION_LABEL_CLASS}>Description</div>
                <div className="prose prose-sm dark:prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] prose-pre:whitespace-pre-wrap prose-pre:break-words">
                  <ReactMarkdown>{proposal.payload.description}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Rationale — all kinds */}
            {proposal.rationale && (
              <div className="space-y-1">
                <div className={SECTION_LABEL_CLASS}>Rationale</div>
                <div className="text-xs text-muted-foreground italic">
                  {proposal.rationale}
                </div>
              </div>
            )}

            {/* Prompt create specific */}
            {proposal.kind === "promptCreate" && proposal.payload.value && (
              <div className="space-y-1">
                <div className={SECTION_LABEL_CLASS}>Value</div>
                <pre className="text-xs font-mono bg-muted/30 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
                  {proposal.payload.value}
                </pre>
              </div>
            )}

            {/* Prompt update specific */}
            {proposal.kind === "promptUpdate" && (
              <div className="space-y-1">
                <div className={SECTION_LABEL_CLASS}>Description change</div>
                {proposal.payload.description ? (
                  <div className="text-xs text-muted-foreground">
                    {proposal.payload.description}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">No description change</div>
                )}
              </div>
            )}

            {/* Concept create specific — show the documentation body */}
            {proposal.kind === "conceptCreate" && proposal.payload.documentation && (
              <div className="space-y-1">
                <div className={SECTION_LABEL_CLASS}>Documentation</div>
                <div className="prose prose-sm dark:prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] prose-pre:whitespace-pre-wrap prose-pre:break-words">
                  <ReactMarkdown>{proposal.payload.documentation}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Feature-specific */}
            {proposal.kind === "feature" && (
              <>
                {/* Planning seed (initialMessage) */}
                {proposal.payload.initialMessage && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Planning seed</div>
                    <div className="prose prose-sm dark:prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] prose-pre:whitespace-pre-wrap prose-pre:break-words">
                      <ReactMarkdown>
                        {proposal.payload.initialMessage}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Feature dependencies */}
                {((proposal.payload.dependsOnFeatureIds?.length ?? 0) > 0 ||
                  (proposal.payload.dependsOnProposalIds?.length ?? 0) > 0) && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Depends on</div>
                    {(proposal.payload.dependsOnFeatureIds?.length ?? 0) >
                      0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">
                          {proposal.payload.dependsOnFeatureIds!.length} feature
                          {proposal.payload.dependsOnFeatureIds!.length === 1
                            ? ""
                            : "s"}
                        </div>
                        <ul className="space-y-0.5">
                          {proposal.payload.dependsOnFeatureIds!.map((id) => (
                            <li
                              key={id}
                              className="text-xs font-mono text-muted-foreground break-all"
                            >
                              {id}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(proposal.payload.dependsOnProposalIds?.length ?? 0) >
                      0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">
                          {proposal.payload.dependsOnProposalIds!.length}{" "}
                          proposal
                          {proposal.payload.dependsOnProposalIds!.length === 1
                            ? ""
                            : "s"}
                        </div>
                        <ul className="space-y-0.5">
                          {proposal.payload.dependsOnProposalIds!.map((id) => (
                            <li
                              key={id}
                              className="text-xs font-mono text-muted-foreground break-all"
                            >
                              {id}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Initiative-specific */}
            {proposal.kind === "initiative" && (
              <>
                {proposal.payload.status && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Status</div>
                    <Badge variant="secondary" className="uppercase">
                      {proposal.payload.status}
                    </Badge>
                  </div>
                )}
                {(proposal.payload.startDate || proposal.payload.targetDate) && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Dates</div>
                    <div className="text-xs text-muted-foreground flex gap-4">
                      {proposal.payload.startDate && (
                        <span>
                          Start:{" "}
                          {new Date(
                            proposal.payload.startDate,
                          ).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}
                      {proposal.payload.targetDate && (
                        <span>
                          Target:{" "}
                          {new Date(
                            proposal.payload.targetDate,
                          ).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Milestone-specific */}
            {proposal.kind === "milestone" && (
              <>
                {proposal.payload.status && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Status</div>
                    <Badge variant="secondary" className="uppercase">
                      {proposal.payload.status}
                    </Badge>
                  </div>
                )}
                {proposal.payload.dueDate && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>Due date</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(proposal.payload.dueDate).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", year: "numeric" },
                      )}
                    </div>
                  </div>
                )}
                {proposal.featureMeta.length > 0 && (
                  <div className="space-y-1">
                    <div className={SECTION_LABEL_CLASS}>
                      Features to attach ({proposal.featureMeta.length})
                    </div>
                    <ul className="space-y-0.5">
                      {proposal.featureMeta.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-baseline gap-1.5 text-xs"
                        >
                          <span className="truncate">{m.title}</span>
                          <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">
                            {m.currentMilestoneId
                              ? `in ${m.currentMilestoneName ?? "another milestone"}`
                              : "(unlinked)"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the proposal has any "extra" fields beyond the
 * required title/name — i.e., there is content worth showing in the
 * Details dialog.
 */
export function proposalHasDetails(p: ProposalOutput): boolean {
  if (p.kind === "feature")
    return !!(
      p.payload.description ||
      p.payload.initialMessage ||
      p.payload.dependsOnFeatureIds?.length ||
      p.payload.dependsOnProposalIds?.length
    );
  if (p.kind === "initiative")
    return !!(
      p.payload.description ||
      p.payload.status ||
      p.payload.startDate ||
      p.payload.targetDate
    );
  if (p.kind === "promptCreate")
    return !!(p.payload.description);
  if (p.kind === "promptUpdate")
    return !!(p.payload.description);
  if (p.kind === "conceptCreate")
    return !!(p.payload.description || p.payload.documentation);
  // conceptUpdate: the doc diff lives in its own "View changes" modal on
  // the card, so there's nothing extra to show in the details dialog.
  if (p.kind === "conceptUpdate") return false;
  // milestone
  return !!(p.payload.description || p.payload.status || p.payload.dueDate);
}

/**
 * Milestone proposal body: small subtext (initiative parent + due
 * date) and the feature checklist. Each row shows a feature title
 * plus a tag — `(unlinked)` for currently-loose features (the
 * default-checked, recommended bucket) and `(in <other> ↗)` for
 * features currently attached to a different milestone of the same
 * initiative (default-unchecked; checking moves them).
 *
 * Reads `featureMeta` directly off the proposal — server-resolved at
 * proposal time, so no fetch on render and the chat transcript
 * stays self-describing across reloads.
 */
function MilestoneMeta({
  proposal,
  checkedIds,
  onToggle,
  isPending,
}: {
  proposal: Extract<ProposalOutput, { kind: "milestone" }>;
  checkedIds: string[];
  onToggle: (featureId: string) => void;
  isPending: boolean;
}) {
  const { payload, featureMeta, meta } = proposal;
  const subtextParts: string[] = [];
  // Prefer the server-resolved initiative name; fall back to a cuid
  // suffix for older proposals that pre-date the `meta` field. Names
  // beat ids for any user-facing UI (CANVAS.md gotcha).
  subtextParts.push(
    `under initiative ${meta?.initiativeName ?? shortId(payload.initiativeId)}`,
  );
  if (payload.dueDate) {
    const d = new Date(payload.dueDate);
    if (!Number.isNaN(d.getTime())) {
      subtextParts.push(
        `due ${d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`,
      );
    }
  }

  // Flag the "moves a feature out of another milestone" case so the
  // user knows what they're approving. Counted off the post-toggle
  // checked list so the warning updates as the user toggles rows.
  const reassignCount = checkedIds.filter((id) => {
    const meta = featureMeta.find((m) => m.id === id);
    return meta?.currentMilestoneId != null;
  }).length;

  return (
    <div className="mt-0.5">
      <div className="text-[11px] text-muted-foreground">
        {subtextParts.join(" · ")}
      </div>
      {featureMeta.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Features to attach ({checkedIds.length}/{featureMeta.length})
          </div>
          <ul className="mt-1 space-y-0.5">
            {featureMeta.map((m) => {
              const checked = checkedIds.includes(m.id);
              const isMove = m.currentMilestoneId != null;
              return (
                <li
                  key={m.id}
                  className="flex items-baseline gap-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!isPending}
                    onChange={() => onToggle(m.id)}
                    className="mt-0.5 h-3 w-3 flex-shrink-0 cursor-pointer disabled:cursor-default"
                    aria-label={`Attach feature ${m.title}`}
                  />
                  <span className="truncate">{m.title}</span>
                  <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">
                    {isMove
                      ? `in ${m.currentMilestoneName ?? "another milestone"}`
                      : "unlinked"}
                  </span>
                </li>
              );
            })}
          </ul>
          {reassignCount > 0 && (
            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
              Will reassign {reassignCount} feature
              {reassignCount === 1 ? "" : "s"} from another milestone.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureMeta({
  payload,
  meta,
}: {
  payload: FeatureProposalPayload;
  meta?: FeatureProposalMeta;
}) {
  // Compact secondary line. Names beat ids for any user-facing UI —
  // `propose_feature` resolves the workspace / initiative / milestone
  // names server-side and stores them on `proposal.meta` so this card
  // renders "Hive · Auth Refactor" instead of "ws s9vogz · init
  // ebbk65". For older proposals (pre-meta) we fall back to the
  // raw cuid suffix as a stable hint — those should age out as old
  // chats roll over.
  const parts: string[] = [];
  if (payload.workspaceId) {
    parts.push(meta?.workspaceName ?? `ws ${shortId(payload.workspaceId)}`);
  }
  if (payload.initiativeId) {
    parts.push(meta?.initiativeName ?? `init ${shortId(payload.initiativeId)}`);
  } else if (payload.parentProposalId) {
    parts.push("under proposed initiative");
  }
  if (payload.milestoneId) {
    parts.push(
      meta?.milestoneName
        ? `milestone ${meta.milestoneName}`
        : `milestone ${shortId(payload.milestoneId)}`,
    );
  }
  if (parts.length === 0) return null;
  return (
    <div className="mt-0.5 text-[11px] text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}

function PromptCreateMeta({
  payload,
}: {
  payload: { name: string; value: string; description?: string };
}) {
  return (
    <div className="mt-0.5">
      {payload.description && (
        <div className="text-[11px] text-muted-foreground truncate">
          {payload.description}
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">
        {payload.value.length} chars
      </div>
    </div>
  );
}

/**
 * Compact summary line for a prompt-update proposal: version tag + a
 * +adds/−dels stat, and a "View changes" button that opens the diff modal.
 * The inline card intentionally shows NO diff body — a large prompt with a
 * one-line edit should render as one line here, not two walls of text.
 */
function PromptUpdateMeta({
  meta,
}: {
  meta: {
    oldStr: string;
    newStr: string;
    promptName?: string;
    versionNumber?: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(
    () => computeUnifiedDiff(meta.oldStr, meta.newStr),
    [meta.oldStr, meta.newStr],
  );

  // value unchanged → description-only update (mcpUpdatePrompt requires the
  // full value even for a description tweak, so oldStr === newStr here).
  const textUnchanged = diff.unchanged;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {meta.versionNumber != null && (
        <span className="font-mono">v{meta.versionNumber}</span>
      )}
      {textUnchanged ? (
        <span className="italic">No prompt-text change</span>
      ) : (
        <>
          <span className="font-mono">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{diff.removed}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <FileDiff className="h-3 w-3" />
            View changes
          </button>
          <PromptDiffDialog
            open={open}
            onOpenChange={setOpen}
            promptName={meta.promptName}
            versionNumber={meta.versionNumber}
            diff={diff}
          />
        </>
      )}
    </div>
  );
}

/**
 * Modal showing ONLY the changed hunks of a prompt update (a few lines of
 * context around each edit, long unchanged runs collapsed) — GitHub-style
 * unified diff, monospace, no diff library.
 */
function PromptDiffDialog({
  open,
  onOpenChange,
  promptName,
  versionNumber,
  diff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptName?: string;
  versionNumber?: number;
  diff: UnifiedDiff;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <div className={SECTION_LABEL_CLASS}>Prompt changes</div>
          <DialogTitle className="text-base min-w-0 break-words [overflow-wrap:anywhere]">
            {promptName ?? "Prompt update"}
            {versionNumber != null && (
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                v{versionNumber}
              </span>
            )}
          </DialogTitle>
          <div className="mt-0.5 font-mono text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{diff.removed}
            </span>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] min-w-0">
          <UnifiedDiffView diff={diff} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** Renders a {@link UnifiedDiff} as red/green rows with collapsed gaps. */
function UnifiedDiffView({ diff }: { diff: UnifiedDiff }) {
  if (diff.unchanged || diff.hunks.length === 0) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground italic">
        No prompt-text changes.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded border font-mono text-[11px] leading-relaxed">
      {diff.hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          {hunk.gapBefore > 0 && (
            <div className="bg-muted/40 px-3 py-0.5 text-[10px] text-muted-foreground">
              ⋯ {hunk.gapBefore} unchanged line{hunk.gapBefore === 1 ? "" : "s"}
            </div>
          )}
          {hunk.rows.map((row, ri) => {
            const sign =
              row.type === "add" ? "+" : row.type === "del" ? "−" : " ";
            const rowClass =
              row.type === "add"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : row.type === "del"
                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "text-muted-foreground";
            return (
              <div key={ri} className={`flex ${rowClass}`}>
                <span className="w-4 flex-shrink-0 select-none px-1 text-center opacity-60">
                  {sign}
                </span>
                <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 pr-2">
                  {row.text === "" ? " " : row.text}
                </pre>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

/** Compact body for a new-concept proposal: repo/workspace + doc size. */
function ConceptCreateMeta({
  payload,
  meta,
}: {
  payload: { name: string; documentation: string; description?: string; repo?: string };
  meta?: { workspaceName?: string; workspaceSlug?: string; repo?: string };
}) {
  const parts: string[] = [];
  if (meta?.workspaceName ?? meta?.workspaceSlug) {
    parts.push((meta.workspaceName ?? meta.workspaceSlug)!);
  }
  const repo = payload.repo ?? meta?.repo;
  if (repo) parts.push(repo);
  return (
    <div className="mt-0.5">
      {payload.description && (
        <div className="text-[11px] text-muted-foreground truncate">
          {payload.description}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        {parts.length > 0 && <span>{parts.join(" · ")}</span>}
        <span>{payload.documentation.length} chars</span>
      </div>
    </div>
  );
}

/**
 * Compact summary line for a concept-documentation update: a +adds/−dels
 * stat plus a "View changes" button opening the diff modal. Mirrors
 * `PromptUpdateMeta` — the inline card shows no diff body.
 */
function ConceptUpdateMeta({
  meta,
}: {
  meta: {
    oldStr: string;
    newStr: string;
    conceptName?: string;
    workspaceSlug?: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(
    () => computeUnifiedDiff(meta.oldStr, meta.newStr),
    [meta.oldStr, meta.newStr],
  );

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {meta.workspaceSlug && <span className="font-mono">{meta.workspaceSlug}</span>}
      {diff.unchanged ? (
        <span className="italic">No documentation change</span>
      ) : (
        <>
          <span className="font-mono">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{diff.removed}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <FileDiff className="h-3 w-3" />
            View changes
          </button>
          <ConceptDiffDialog
            open={open}
            onOpenChange={setOpen}
            conceptName={meta.conceptName}
            diff={diff}
          />
        </>
      )}
    </div>
  );
}

/** Diff modal for a concept documentation update (mirrors PromptDiffDialog). */
function ConceptDiffDialog({
  open,
  onOpenChange,
  conceptName,
  diff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conceptName?: string;
  diff: UnifiedDiff;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <div className={SECTION_LABEL_CLASS}>Documentation changes</div>
          <DialogTitle className="text-base min-w-0 break-words [overflow-wrap:anywhere]">
            {conceptName ?? "Concept update"}
          </DialogTitle>
          <div className="mt-0.5 font-mono text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{diff.removed}
            </span>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] min-w-0">
          <UnifiedDiffView diff={diff} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
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
      tc.toolName !== PROPOSE_FEATURE_TOOL &&
      tc.toolName !== PROPOSE_MILESTONE_TOOL &&
      tc.toolName !== PROPOSE_NEW_PROMPT_TOOL &&
      tc.toolName !== PROPOSE_PROMPT_UPDATE_TOOL &&
      tc.toolName !== PROPOSE_NEW_CONCEPT_TOOL &&
      tc.toolName !== PROPOSE_CONCEPT_UPDATE_TOOL
    )
      continue;
    const o = tc.output;
    if (!o || typeof o !== "object") continue;
    if ("error" in o) continue;
    out.push(o as ProposalOutput);
  }
  return out;
}

/**
 * Topologically sorts a list of proposals so that blockers appear before
 * their dependents. Only intra-batch dependencies are considered — cross-
 * message blockers are already ordered by message history.
 *
 * Uses Kahn's algorithm. Falls back to the original order if a cycle is
 * detected (shouldn't happen in practice, but never block rendering).
 */
export function sortProposalsByDependency(
  proposals: ProposalOutput[],
): ProposalOutput[] {
  if (proposals.length <= 1) return proposals;

  // Index of proposal IDs present in this batch.
  const ids = new Set(proposals.map((p) => p.proposalId));

  // in-degree: number of blockers present in THIS batch.
  // blockedBy: blocker proposalId → list of dependent proposalIds it unblocks.
  const inDegree = new Map<string, number>();
  const blockedBy = new Map<string, string[]>();

  for (const p of proposals) {
    if (!inDegree.has(p.proposalId)) inDegree.set(p.proposalId, 0);
    const deps =
      p.kind === "feature" ? (p.payload.dependsOnProposalIds ?? []) : [];
    for (const dep of deps) {
      if (!ids.has(dep)) continue; // cross-message dep — skip
      inDegree.set(p.proposalId, (inDegree.get(p.proposalId) ?? 0) + 1);
      const list = blockedBy.get(dep) ?? [];
      list.push(p.proposalId);
      blockedBy.set(dep, list);
    }
  }

  const byId = new Map(proposals.map((p) => [p.proposalId, p]));
  const queue = proposals.filter(
    (p) => (inDegree.get(p.proposalId) ?? 0) === 0,
  );
  const sorted: ProposalOutput[] = [];

  while (queue.length) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const depId of blockedBy.get(node.proposalId) ?? []) {
      const newDeg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) queue.push(byId.get(depId)!);
    }
  }

  // Cycle guard — return original order if sort is incomplete.
  return sorted.length === proposals.length ? sorted : proposals;
}
