import { tool, ToolSet } from "ai";
import { z } from "zod";

import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap";
import { getUserActivityFeed } from "@/services/roadmap/user-activity";
import {
  assignFeatureOnCanvas,
  notifyFeatureAssignmentRefreshByOrg,
  notifyFeatureReassignmentRefresh,
  unassignFeatureOnCanvas,
} from "@/lib/canvas";
import { loadNodeDetail } from "@/services/orgs/nodeDetail";
import type {
  MilestoneFeatureMeta,
  Placement,
  ProposalOutput,
} from "@/lib/proposals/types";
import {
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";

/**
 * Shared zod schema for the `placement` field on every propose tool.
 *
 * The agent never emits raw pixels — it picks a verb plus a live
 * anchor id it saw in `read_canvas` output. The approval handler
 * resolves it via `resolvePlacement` in `@/lib/canvas/placement`.
 *
 * Validation here is lenient on the anchor id: we accept any
 * non-empty string after the verb. Stricter validation (anchor
 * exists on the target canvas) lives in the resolver, where it
 * naturally falls back to auto-layout instead of failing the
 * proposal — LLMs hallucinate ids, and a forgiving placement
 * pipeline beats a brittle one.
 */
const placementSchema = z
  .union([
    z.literal("auto"),
    z
      .string()
      .regex(/^(near|above|below|left-of|right-of):.+$/, {
        message:
          "Placement must be `auto` or `<verb>:<liveId>` where verb is " +
          "one of near|above|below|left-of|right-of.",
      }),
  ])
  .optional();

/**
 * Description string reused on every propose tool's `placement` field.
 * Centralized so the wording stays in lock-step across all three tools
 * and matches the prompt suffix in `src/lib/constants/prompt.ts`.
 */
const PLACEMENT_DESCRIPTION =
  "Where to place the new card on the canvas. Always provide: pick " +
  "deliberately based on `read_canvas` output for the canvas this " +
  "card will land on — don't omit it; pick `auto` explicitly if you " +
  "have no opinion. " +
  "Vocabulary: `auto` (let auto-layout pick), " +
  "`near:<liveId>` / `right-of:<liveId>` (same row, to the right of " +
  "anchor), `left-of:<liveId>` (same row, to the left), " +
  "`below:<liveId>` (start a new row beneath anchor), " +
  "`above:<liveId>` (start a new row above anchor). " +
  "`<liveId>` is the full prefixed id from `read_canvas` (e.g. " +
  "`feature:cmoti7…`, `initiative:cmnxk2…`, `ws:cmoz9c…`, " +
  "`milestone:cmpqv1…`). " +
  "Anchor MUST live on the canvas the new card lands on " +
  "(initiative → root canvas; milestone → its parent initiative " +
  "canvas; feature → its initiative canvas if anchored, else its " +
  "workspace canvas). Unresolvable placements (anchor missing, " +
  "wrong canvas, slot collides) silently fall back to `auto` — so " +
  "if you're unsure, use `auto` explicitly. " +
  "Milestones read as a timeline: for a new milestone, prefer " +
  "`right-of:milestone:<latest-existing-id>` to extend the row to " +
  "the right. For a loose feature (no `initiativeId`), its target " +
  "canvas is its workspace's (`ws:<id>`), not the initiative's — " +
  "`below:initiative:<id>` only works when the anchor is actually on " +
  "that same target canvas; otherwise it silently falls back to " +
  "`auto` (see `dependsOnProposalIds` for the layering-above " +
  "reference these anchors support).";

/**
 * Tools for the org canvas chat agent's roadmap surface.
 *
 * Four tools:
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
 *   - `propose_milestone` — same shape, for milestones, with one
 *     extra trick: a milestone proposal can carry a list of
 *     `featureIds` to attach on approval. Every featureId must
 *     already belong to the proposed `initiativeId`; the propose
 *     tool also resolves `featureMeta` (titles + current-milestone
 *     names) so the card's checklist renders without a fetch. See
 *     `docs/plans/propose-milestone.md`.
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
export function buildInitiativeTools(
  orgId: string,
  userId: string,
): ToolSet {
  return {
    read_initiative: tool({
      description:
        "Read an Initiative's full detail by id (the cuid that follows " +
        "the `initiative:` prefix on canvas node ids). Returns " +
        "`{ kind, id, name, description, extras }` where `extras` " +
        "includes `status`, `startDate`, `targetDate`, `completedAt`, " +
        "`assignee`, and `milestoneCount`. **Use this whenever the user " +
        "asks about an initiative's intent or scope** — `read_canvas` " +
        "only returns the projector's render-time shape (name + footer " +
        "counts), NOT the `description` field. So 'what does the Q3 " +
        "Growth initiative cover?' or 'extend that initiative's brief' " +
        "needs `read_initiative` to see the full description. Returns " +
        "`{ error }` if the id doesn't exist or doesn't belong to this " +
        "org (the org guard is identical to the right-panel REST route).",
      inputSchema: z.object({
        initiativeId: z
          .string()
          .min(1)
          .describe(
            "The initiative's cuid. From a canvas node id of the form " +
              "`initiative:<cuid>`, pass just the `<cuid>` part.",
          ),
      }),
      execute: async ({ initiativeId }: { initiativeId: string }) => {
        try {
          const detail = await loadNodeDetail("initiative", initiativeId, orgId);
          if (!detail) {
            return {
              error:
                "Initiative not found in this organization. Confirm the id exists on the org canvas.",
            };
          }
          return detail;
        } catch (e) {
          console.error("[initiativeTools.read_initiative] error:", e);
          return { error: "Failed to read initiative" };
        }
      },
    }),

    read_milestone: tool({
      description:
        "Read a Milestone's full detail by id (the cuid that follows the " +
        "`milestone:` prefix on canvas node ids). Returns " +
        "`{ kind, id, name, description, extras }` where `extras` " +
        "includes `status`, `dueDate`, `completedAt`, `sequence`, " +
        "`assignee`, the parent `initiative` (id + name), and " +
        "`featureCount`. Use this when the user asks about a specific " +
        "milestone's scope/timeline — `read_canvas` of the parent " +
        "initiative shows the milestone card but not its `description` " +
        "or `assignee`. Returns `{ error }` if the id doesn't exist or " +
        "doesn't belong to this org.",
      inputSchema: z.object({
        milestoneId: z
          .string()
          .min(1)
          .describe(
            "The milestone's cuid. From a canvas node id of the form " +
              "`milestone:<cuid>`, pass just the `<cuid>` part.",
          ),
      }),
      execute: async ({ milestoneId }: { milestoneId: string }) => {
        try {
          const detail = await loadNodeDetail("milestone", milestoneId, orgId);
          if (!detail) {
            return {
              error:
                "Milestone not found in this organization. Confirm the id exists on the parent initiative's canvas.",
            };
          }
          return detail;
        } catch (e) {
          console.error("[initiativeTools.read_milestone] error:", e);
          return { error: "Failed to read milestone" };
        }
      },
    }),

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

    // ─── assign_feature_to_workspace ──────────────────────────────────
    // Pin an existing feature onto a workspace's sub-canvas. The
    // mutation only touches `CanvasBlob.assignedFeatures` (the per-
    // canvas overlay) — the Feature row itself is unchanged. Useful
    // when the user asks the agent to "show this feature on the
    // [workspace name] canvas" or "pin the auth features onto the
    // hive workspace." Idempotent: re-pinning an already-pinned
    // feature is a no-op.
    //
    // **`workspaceSlug` not `workspaceId`** — matches `propose_feature`'s
    // pattern. The agent has the slug list in the system prompt
    // (**Available Workspaces**); echoing a cuid would force the
    // agent to first call `read_canvas` to discover it. The tool
    // resolves slug → cuid internally.
    //
    // **Validation pattern** mirrors `assign_feature_to_initiative`:
    // the feature must exist, belong to this org, AND belong to the
    // target workspace. A feature from workspace A can't be pinned
    // onto workspace B — features still belong to exactly one
    // workspace, and pinning surfaces the feature card with title +
    // status in the canvas, so cross-workspace pinning would be a
    // small read-leak surface.
    assign_feature_to_workspace: tool({
      description:
        "Pin an existing feature onto a workspace's sub-canvas so it " +
        "shows up as a card alongside the workspace's repos and " +
        "authored services. The workspace canvas no longer auto-" +
        "projects features — pinning is explicit, and only pinned " +
        "features render there. Use this when the user asks to " +
        "'add the auth feature to the hive workspace canvas', " +
        "'show me feature X on workspace Y', 'pin these features to " +
        "the dashboard workspace,' etc. The feature is unchanged — " +
        "only its visibility on this one canvas. The feature MUST " +
        "already belong to the target workspace (cross-workspace " +
        "pinning is rejected); call `assign_feature_to_initiative` " +
        "or move the feature first if needed. Idempotent — re-pinning " +
        "a pinned feature returns success.",
      inputSchema: z.object({
        featureId: z
          .string()
          .min(1)
          .describe("The id of the feature to pin."),
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "The slug of the workspace whose canvas to pin onto " +
              "(e.g. `hive`, `stakgraph`). Use the slug shown in the " +
              "**Available Workspaces** list at the top of the " +
              "system prompt — never an opaque id. The feature must " +
              "already live in this workspace.",
          ),
      }),
      execute: async ({
        featureId,
        workspaceSlug,
      }: {
        featureId: string;
        workspaceSlug: string;
      }) => {
        try {
          // Resolve slug → cuid + validate org ownership in one
          // query. Mirror of the `propose_feature` resolution pattern.
          const workspace = await db.workspace.findFirst({
            where: {
              slug: workspaceSlug,
              sourceControlOrgId: orgId,
              deleted: false,
            },
            select: { id: true, name: true, slug: true },
          });
          if (!workspace) {
            return {
              error:
                "Workspace slug not found in this organization. Pick a slug from the **Available Workspaces** list at the top of your system prompt.",
            };
          }

          const feature = await db.feature.findUnique({
            where: { id: featureId },
            select: {
              workspaceId: true,
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
          if (feature.workspaceId !== workspace.id) {
            return {
              error:
                "Feature does not belong to the target workspace. Move the feature with `assign_feature_to_initiative`'s workspace-change pattern (not yet supported) or pick the feature's actual workspace.",
            };
          }
          const ref = `ws:${workspace.id}`;
          await assignFeatureOnCanvas(orgId, ref, featureId);
          void notifyFeatureAssignmentRefreshByOrg(
            orgId,
            ref,
            featureId,
            "feature-pinned",
          );
          return {
            status: "pinned",
            featureId,
            workspaceSlug: workspace.slug,
            workspaceName: workspace.name,
            ref,
          };
        } catch (e) {
          console.error(
            "[initiativeTools.assign_feature_to_workspace] error:",
            e,
          );
          const message =
            e instanceof Error ? e.message : "Failed to pin feature";
          return { error: message };
        }
      },
    }),

    // ─── unassign_feature_from_workspace ──────────────────────────────
    // Mirror of `assign_feature_to_workspace`. Same validation rules
    // (org ownership + workspace ownership). Idempotent — unpinning a
    // feature that isn't pinned is a no-op.
    unassign_feature_from_workspace: tool({
      description:
        "Unpin a feature from a workspace's sub-canvas. The feature " +
        "row is unchanged — only its visibility on this one canvas. " +
        "Idempotent — unpinning a feature that isn't pinned succeeds " +
        "silently. Use when the user asks to 'remove feature X from " +
        "the [workspace] canvas' or 'clean up the workspace canvas.'",
      inputSchema: z.object({
        featureId: z
          .string()
          .min(1)
          .describe("The id of the feature to unpin."),
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "The slug of the workspace whose canvas to unpin from " +
              "(e.g. `hive`, `stakgraph`). Use the slug shown in the " +
              "**Available Workspaces** list at the top of the " +
              "system prompt — never an opaque id.",
          ),
      }),
      execute: async ({
        featureId,
        workspaceSlug,
      }: {
        featureId: string;
        workspaceSlug: string;
      }) => {
        try {
          const workspace = await db.workspace.findFirst({
            where: {
              slug: workspaceSlug,
              sourceControlOrgId: orgId,
              deleted: false,
            },
            select: { id: true, name: true, slug: true },
          });
          if (!workspace) {
            return {
              error:
                "Workspace slug not found in this organization. Pick a slug from the **Available Workspaces** list at the top of your system prompt.",
            };
          }

          const feature = await db.feature.findUnique({
            where: { id: featureId },
            select: {
              workspaceId: true,
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
          if (feature.workspaceId !== workspace.id) {
            return {
              error:
                "Feature does not belong to the target workspace.",
            };
          }
          const ref = `ws:${workspace.id}`;
          await unassignFeatureOnCanvas(orgId, ref, featureId);
          void notifyFeatureAssignmentRefreshByOrg(
            orgId,
            ref,
            featureId,
            "feature-unpinned",
          );
          return {
            status: "unpinned",
            featureId,
            workspaceSlug: workspace.slug,
            workspaceName: workspace.name,
            ref,
          };
        } catch (e) {
          console.error(
            "[initiativeTools.unassign_feature_from_workspace] error:",
            e,
          );
          const message =
            e instanceof Error ? e.message : "Failed to unpin feature";
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
        "Propose a new Initiative for this org. USE THIS whenever the " +
        "user asks you to add, create, draft, sketch, suggest, " +
        "brainstorm, spin up, kick off, set up, plan, or start a new " +
        "initiative — e.g. 'add a product promotion initiative', " +
        "'create me an onboarding revamp initiative', 'spin up Q2 " +
        "growth', 'suggest some initiatives.' This tool does NOT " +
        "write to the DB; it emits a proposal card in chat that the " +
        "user explicitly approves with a click — approval is what " +
        "creates the row. Do NOT decline initiative-creation requests " +
        "by telling the user to use the '+' button; that advice is " +
        "for Workspaces / Repositories / Milestones, not initiatives. " +
        "To propose features grouped under the same not-yet-approved " +
        "initiative, set `parentProposalId` on each feature proposal " +
        "to this proposal's `proposalId`.",
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
        placement: placementSchema.describe(PLACEMENT_DESCRIPTION),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        // No DB writes — propose tools just structure the suggestion.
        // The handler at approval time re-validates and creates the row.
        // `placement` is passed through verbatim; resolution to (x, y)
        // happens in `handleApproval` via `resolvePlacement` so the
        // anchor's live position is read once at the actual create
        // time, not at propose time (the canvas may have moved).
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
            ...(input.placement && {
              placement: input.placement as Placement,
            }),
          },
          ...(input.rationale && { rationale: input.rationale }),
        };
      },
    }),

    // ─── propose_milestone ───────────────────────────────────────────
    // Emit a structured Milestone proposal that can additionally carry
    // a list of features to attach on approval. No DB write here —
    // approval-time creates the row + PATCHes feature.milestoneId in
    // a transaction. See `docs/plans/propose-milestone.md`.
    //
    // Validation re-uses the same org-ownership pattern as the other
    // tools, plus a per-feature invariant: every featureId in the
    // payload MUST already belong to `initiativeId` (a milestone can
    // only own features of its parent initiative). We also resolve
    // `featureMeta` from the same query so the card's checklist
    // renders without a fetch.
    [PROPOSE_MILESTONE_TOOL]: tool({
      description:
        "Propose a new Milestone under an existing Initiative for " +
        "this org, optionally attaching a list of existing features " +
        "on approval. USE THIS whenever the user asks you to add, " +
        "create, draft, sketch, suggest, brainstorm, spin up, kick " +
        "off, set up, plan, propose, or start a new milestone — " +
        "e.g. 'propose a Q3 dashboard milestone', 'draft a launch " +
        "milestone for billing v2', 'suggest two milestones for the " +
        "rest of this initiative.' This tool does NOT write to the " +
        "DB; it emits a proposal card in chat that the user " +
        "explicitly approves with a click — approval is what creates " +
        "the milestone (and attaches the listed features). Do NOT " +
        "decline milestone-creation requests by telling the user to " +
        "use the '+' button. " +
        "**BEFORE calling this tool**, you MUST call `read_canvas` " +
        "with `ref: \"initiative:<id>\"` for the parent initiative, " +
        "so you can see (a) the existing milestones (don't duplicate) " +
        "and (b) the features anchored to this initiative — " +
        "including which already have a milestone (rendered with a " +
        "synthetic edge to a milestone card) and which are unlinked. " +
        "**`featureIds` should be biased toward currently-unlinked " +
        "features** (no synthetic edge to any milestone card). " +
        "Attaching an already-linked feature is legal but moves it " +
        "from its current milestone to the new one — only do that " +
        "if the user has explicitly asked. Empty `featureIds` is " +
        "fine — the user can attach features later. " +
        "**Do NOT pick a `sequence`** — the system computes it " +
        "(`MAX(sequence) + 1` for the initiative).",
      inputSchema: z.object({
        proposalId: z
          .string()
          .min(1)
          .describe(
            "Stable id for this proposal. Generate a fresh short " +
              "alphanumeric per call.",
          ),
        initiativeId: z
          .string()
          .min(1)
          .describe(
            "Parent initiative id. Required. The milestone will be " +
              "created under this initiative.",
          ),
        name: z.string().min(1).describe("Milestone title."),
        description: z.string().optional(),
        status: z
          .enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"])
          .optional()
          .describe(
            "Default NOT_STARTED. Use IN_PROGRESS only if the user " +
              "has stated work has already begun.",
          ),
        dueDate: z.string().optional().describe("ISO date string."),
        assigneeId: z
          .string()
          .optional()
          .describe(
            "Optional user id to assign. If unsure, omit — the user " +
              "can assign at approval time.",
          ),
        featureIds: z
          .array(z.string().min(1))
          .default([])
          .describe(
            "Feature ids to attach to the new milestone on approval. " +
              "EVERY id MUST already belong to `initiativeId` — a " +
              "milestone can only own features of its parent " +
              "initiative. Bias toward currently-unlinked features " +
              "(no synthetic edge to any milestone card). Empty list " +
              "is fine. Use `read_canvas(ref: \"initiative:<id>\")` " +
              "to discover candidates.",
          ),
        rationale: z
          .string()
          .optional()
          .describe(
            "One short sentence of justification rendered on the " +
              "card. Optional but useful when proposing several at once.",
          ),
        placement: placementSchema.describe(PLACEMENT_DESCRIPTION),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        try {
          // 1. Validate initiative belongs to this org. We also pull
          //    `name` so the proposal card's subtext can read "under
          //    initiative <name>" instead of "<cuid suffix>" (see
          //    `MilestoneProposalMeta`).
          const initiative = await db.initiative.findFirst({
            where: { id: input.initiativeId, orgId },
            select: { id: true, name: true },
          });
          if (!initiative) {
            return {
              error:
                "Initiative not found in this organization. Pick an " +
                "initiative from this org's root canvas.",
            };
          }

          // 2. Per-feature validation + featureMeta resolution in
          //    one round trip. We need title, current milestoneId,
          //    initiativeId (for the invariant check), and the
          //    workspace's sourceControlOrgId (for org ownership).
          //    Skip when featureIds is empty.
          let featureMeta: MilestoneFeatureMeta[] = [];
          if (input.featureIds.length > 0) {
            // De-dupe to be defensive — agent could repeat ids.
            const uniqueIds = Array.from(new Set(input.featureIds));
            const features = await db.feature.findMany({
              where: { id: { in: uniqueIds }, deleted: false },
              select: {
                id: true,
                title: true,
                initiativeId: true,
                milestoneId: true,
                workspace: { select: { sourceControlOrgId: true } },
                milestone: { select: { name: true } },
              },
            });
            if (features.length !== uniqueIds.length) {
              const found = new Set(features.map((f) => f.id));
              const missing = uniqueIds.filter((id) => !found.has(id));
              return {
                error:
                  "Feature(s) not found or deleted: " + missing.join(", "),
              };
            }
            const wrongOrg = features.filter(
              (f) => f.workspace.sourceControlOrgId !== orgId,
            );
            if (wrongOrg.length > 0) {
              return {
                error:
                  "Feature(s) do not belong to this organization: " +
                  wrongOrg.map((f) => f.id).join(", "),
              };
            }
            const wrongInitiative = features.filter(
              (f) => f.initiativeId !== input.initiativeId,
            );
            if (wrongInitiative.length > 0) {
              return {
                error:
                  "Feature(s) do not belong to the supplied initiative " +
                  "(a milestone can only own features of its parent " +
                  "initiative): " +
                  wrongInitiative.map((f) => f.id).join(", "),
              };
            }
            featureMeta = features.map((f) => ({
              id: f.id,
              title: f.title,
              currentMilestoneId: f.milestoneId,
              currentMilestoneName: f.milestone?.name ?? null,
            }));
          }

          return {
            kind: "milestone",
            proposalId: input.proposalId,
            payload: {
              initiativeId: input.initiativeId,
              name: input.name,
              ...(input.description !== undefined && {
                description: input.description,
              }),
              ...(input.status !== undefined && { status: input.status }),
              ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
              ...(input.assigneeId !== undefined && {
                assigneeId: input.assigneeId,
              }),
              featureIds: input.featureIds,
              ...(input.placement && {
                placement: input.placement as Placement,
              }),
            },
            featureMeta,
            meta: { initiativeName: initiative.name },
            ...(input.rationale && { rationale: input.rationale }),
          };
        } catch (e) {
          console.error("[initiativeTools.propose_milestone] error:", e);
          const message =
            e instanceof Error ? e.message : "Failed to propose milestone";
          return { error: message };
        }
      },
    }),

    // ─── read_user_activity ───────────────────────────────────────────────
    read_user_activity: tool({
      description:
        "Query the current user's recent activity feed (tasks, plans, chats, milestones) " +
        "across all orgs and workspaces. Use this to understand what the user has been " +
        "working on before making cross-feature suggestions, or when the user asks " +
        "'what have I been up to?'. Returns an array of ActivityItem objects sorted " +
        "newest-first.",
      inputSchema: z.object({
        category: z
          .enum(["task", "plan", "chat", "milestone"])
          .optional()
          .describe("Filter by activity type. Omit to return all categories."),
        q: z
          .string()
          .optional()
          .describe("Case-insensitive title search. Omit to skip filtering."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("Max results to return. Default 20, max 40."),
      }),
      execute: async ({ category, q, limit }) => {
        try {
          const items = await getUserActivityFeed({
            userId,
            category: category ?? null,
            q,
            limit,
          });
          return { items };
        } catch (e) {
          return { error: "Failed to load activity feed" };
        }
      },
    }),
  };
}
