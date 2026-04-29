import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap";
import { notifyFeatureReassignmentRefresh } from "@/services/roadmap/feature-canvas-notify";
import type { ProposalOutput } from "@/lib/proposals/types";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
} from "@/lib/proposals/types";

/**
 * Tools for the org canvas chat agent's roadmap surface.
 *
 * Three tools:
 *   - `assign_feature_to_initiative` — *organize* existing features
 *     under an existing initiative/milestone. Mutates the DB
 *     immediately. Validates org ownership.
 *   - `propose_initiative` — emit an `Initiative` proposal as a tool
 *     output. Does NOT write to the DB. The chat is the source of
 *     truth for proposal lifecycle; the user clicks Approve in
 *     `<ProposalCard>` and `/api/ask/quick` runs the side effect.
 *   - `propose_feature` — same shape, for features. Validates
 *     workspace/initiative/milestone ownership at proposal time so
 *     the agent doesn't need a re-validation round-trip on approval.
 *
 * The propose tools are deliberately non-creating: the human-only
 * invariant (CANVAS.md "agent does NOT create initiatives or
 * milestones") survives by routing all writes through human approval.
 *
 * Discovery: the agent already has per-workspace `<slug>__list_features`
 * tools (see `askToolsMulti.ts`). It should fan out across those to
 * find candidate features for `assign_feature_to_initiative`, and to
 * pick the right `workspaceId` when proposing a feature.
 *
 * Validation: every mutation (or proposal) verifies workspace / org
 * ownership against `orgId` so an agent invoked under org A can never
 * reassign or propose into org B even if it guesses a cuid.
 */
export function buildInitiativeTools(orgId: string, userId: string): ToolSet {
  return {
    assign_feature_to_initiative: tool({
      description:
        "Attach an existing feature to (or detach it from) an initiative " +
        "and/or milestone. Pass `null` to detach. If only `milestoneId` " +
        "is provided, the feature's `initiativeId` is derived from the " +
        "milestone automatically — you don't need to send both. Use this " +
        "after the user creates a new initiative and asks to organize " +
        "existing features under it. To discover features, call the " +
        "per-workspace `<slug>__list_features` tools first.",
      inputSchema: z.object({
        featureId: z
          .string()
          .describe("The id of the feature to (re)assign."),
        initiativeId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Initiative id to attach to, `null` to detach, or omit to " +
              "leave unchanged. If `milestoneId` is also provided, the " +
              "service derives `initiativeId` from the milestone — any " +
              "value passed here must match.",
          ),
        milestoneId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Milestone id to attach to, `null` to detach, or omit to " +
              "leave unchanged. The milestone must belong to the " +
              "initiative.",
          ),
      }),
      execute: async ({
        featureId,
        initiativeId,
        milestoneId,
      }: {
        featureId: string;
        initiativeId?: string | null;
        milestoneId?: string | null;
      }) => {
        try {
          if (initiativeId === undefined && milestoneId === undefined) {
            return {
              error:
                "Pass at least one of `initiativeId` or `milestoneId`.",
            };
          }

          // Verify the feature exists and lives in a workspace owned
          // by this org. Without this check, an agent acting under
          // org A could mutate features in org B by guessing ids.
          const feature = await db.feature.findUnique({
            where: { id: featureId },
            select: {
              workspaceId: true,
              milestoneId: true,
              initiativeId: true,
              workspace: {
                select: { sourceControlOrgId: true },
              },
            },
          });
          if (!feature) {
            return { error: "Feature not found" };
          }
          if (feature.workspace.sourceControlOrgId !== orgId) {
            return { error: "Feature does not belong to this organization" };
          }

          // If the caller supplied an initiativeId, confirm it lives
          // under this org. (Milestones get validated transitively by
          // `updateFeature`'s invariant check.)
          if (initiativeId) {
            const initiative = await db.initiative.findUnique({
              where: { id: initiativeId },
              select: { orgId: true },
            });
            if (!initiative || initiative.orgId !== orgId) {
              return { error: "Initiative not found in this organization" };
            }
          }

          // Build the partial update — only forward the fields the
          // caller actually set, so omitted ones stay untouched.
          const data: {
            initiativeId?: string | null;
            milestoneId?: string | null;
          } = {};
          if (initiativeId !== undefined) data.initiativeId = initiativeId;
          if (milestoneId !== undefined) data.milestoneId = milestoneId;

          await updateFeature(featureId, userId, data);

          // Fan out CANVAS_UPDATED on every canvas the feature left
          // and the one it landed on (root, both initiatives, both
          // milestones, the workspace). Same helper the REST PATCH
          // route uses — fire-and-forget.
          void notifyFeatureReassignmentRefresh(featureId, {
            milestoneId: feature.milestoneId,
            initiativeId: feature.initiativeId,
            workspaceId: feature.workspaceId,
          });

          return {
            status: "assigned",
            featureId,
            initiativeId: data.initiativeId,
            milestoneId: data.milestoneId,
          };
        } catch (e) {
          console.error("[initiativeTools.assign_feature_to_initiative] error:", e);
          const message =
            e instanceof Error ? e.message : "Failed to assign feature";
          return { error: message };
        }
      },
    }),

    // ─── propose_initiative ──────────────────────────────────────────
    // Emit a structured Initiative proposal back to chat. No DB write.
    // Approval (and therefore creation) flows through `/api/ask/quick`'s
    // pre-LLM `handleApproval` step when the user clicks ✓ on the card.
    [PROPOSE_INITIATIVE_TOOL]: tool({
      description:
        "Propose a new initiative for this org. Does NOT create the " +
        "initiative — emits a proposal the user must approve in chat. " +
        "Use when the user asks you to suggest, draft, or sketch a " +
        "new initiative. To propose features grouped under the same " +
        "(not-yet-approved) initiative, set `parentProposalId` on each " +
        "feature proposal to this proposal's `proposalId`.",
      inputSchema: z.object({
        proposalId: z
          .string()
          .min(1)
          .describe(
            "Stable id for this proposal. Use a short cuid-ish " +
              "string (e.g. random alphanumerics). Re-using the same " +
              "id across calls is a bug — generate a new one per " +
              "proposal.",
          ),
        name: z.string().min(1).describe("Initiative title."),
        description: z.string().optional(),
        status: z
          .enum(["DRAFT", "ACTIVE"])
          .optional()
          .describe(
            "Default DRAFT. Use ACTIVE only if the user has stated " +
              "the initiative is starting now.",
          ),
        assigneeId: z
          .string()
          .optional()
          .describe(
            "Optional user id to assign. If unsure, omit — the user " +
              "can assign at approval time.",
          ),
        startDate: z
          .string()
          .optional()
          .describe("ISO date string."),
        targetDate: z
          .string()
          .optional()
          .describe("ISO date string."),
        rationale: z
          .string()
          .optional()
          .describe(
            "One short sentence of justification rendered on the " +
              "card. Optional but useful when proposing several at once.",
          ),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        // No DB writes — propose tools just structure the suggestion.
        // The handler at approval time re-validates and creates the row.
        return {
          kind: "initiative",
          proposalId: input.proposalId,
          payload: {
            name: input.name,
            ...(input.description && { description: input.description }),
            ...(input.status && { status: input.status }),
            ...(input.assigneeId && { assigneeId: input.assigneeId }),
            ...(input.startDate && { startDate: input.startDate }),
            ...(input.targetDate && { targetDate: input.targetDate }),
          },
          ...(input.rationale && { rationale: input.rationale }),
        };
      },
    }),

    // ─── propose_feature ─────────────────────────────────────────────
    // Same shape as propose_initiative; validates workspace + (if
    // supplied) initiative / milestone ownership against `orgId` so
    // the agent can't propose into another org by guessing cuids.
    // `parentProposalId` is NOT validated here — the conversation
    // transcript isn't visible to the tool. Approval-time validates it
    // by scanning the conversation for the matching `approvalResult`.
    [PROPOSE_FEATURE_TOOL]: tool({
      description:
        "Propose a new feature in a specific workspace, optionally " +
        "under an existing or proposed initiative/milestone. Does NOT " +
        "create the feature — emits a proposal the user must approve. " +
        "To group multiple features under a not-yet-approved " +
        "initiative from this same conversation, set `parentProposalId` " +
        "to that initiative proposal's id; the approval handler wires " +
        "them up automatically. To file a feature under an EXISTING " +
        "initiative or milestone, use `initiativeId` / `milestoneId` " +
        "instead.",
      inputSchema: z.object({
        proposalId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        workspaceId: z
          .string()
          .min(1)
          .describe(
            "The workspace this feature lives in. Required. Use " +
              "the per-workspace `<slug>__list_features` tools or the " +
              "`read_canvas` tool to discover workspace ids.",
          ),
        initiativeId: z
          .string()
          .optional()
          .describe(
            "Existing initiative to attach to. Mutually exclusive with " +
              "`parentProposalId` (use exactly one when grouping).",
          ),
        milestoneId: z
          .string()
          .optional()
          .describe(
            "Existing milestone to attach to. Implies the milestone's " +
              "initiative — you don't need to set both.",
          ),
        parentProposalId: z
          .string()
          .optional()
          .describe(
            "Id of a sibling `propose_initiative` call in this " +
              "conversation. Approval-time resolves this to the new " +
              "initiative's id once the parent has been approved.",
          ),
        rationale: z.string().optional(),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        try {
          // Validate workspace ↔ org ownership. Same pattern as
          // assign_feature_to_initiative above.
          const workspace = await db.workspace.findFirst({
            where: {
              id: input.workspaceId,
              sourceControlOrgId: orgId,
              deleted: false,
            },
            select: { id: true },
          });
          if (!workspace) {
            return {
              error:
                "Workspace not found in this organization. Pick a workspace from this org.",
            };
          }

          // If initiativeId is supplied, confirm it lives under this
          // org. Milestones get validated transitively (via the
          // milestone → initiative → org chain).
          if (input.initiativeId) {
            const initiative = await db.initiative.findFirst({
              where: { id: input.initiativeId, orgId },
              select: { id: true },
            });
            if (!initiative) {
              return {
                error: "Initiative not found in this organization.",
              };
            }
          }
          if (input.milestoneId) {
            const milestone = await db.milestone.findFirst({
              where: {
                id: input.milestoneId,
                initiative: { orgId },
              },
              select: { id: true, initiativeId: true },
            });
            if (!milestone) {
              return {
                error: "Milestone not found in this organization.",
              };
            }
            // If both initiativeId and milestoneId are supplied, they
            // must agree. Approval-time enforces this too via the
            // `updateFeature` invariant, but catching it here gives the
            // agent immediate feedback.
            if (
              input.initiativeId &&
              input.initiativeId !== milestone.initiativeId
            ) {
              return {
                error:
                  "Milestone does not belong to the supplied initiative. Pass only `milestoneId` (initiative is derived).",
              };
            }
          }

          if (input.initiativeId && input.parentProposalId) {
            return {
              error:
                "Pass either `initiativeId` (existing) or `parentProposalId` (proposed-in-this-chat), not both.",
            };
          }

          return {
            kind: "feature",
            proposalId: input.proposalId,
            payload: {
              title: input.title,
              ...(input.description && { description: input.description }),
              workspaceId: input.workspaceId,
              ...(input.initiativeId && {
                initiativeId: input.initiativeId,
              }),
              ...(input.milestoneId && { milestoneId: input.milestoneId }),
              ...(input.parentProposalId && {
                parentProposalId: input.parentProposalId,
              }),
            },
            ...(input.rationale && { rationale: input.rationale }),
          };
        } catch (e) {
          console.error("[initiativeTools.propose_feature] error:", e);
          const message =
            e instanceof Error ? e.message : "Failed to propose feature";
          return { error: message };
        }
      },
    }),
  };
}
