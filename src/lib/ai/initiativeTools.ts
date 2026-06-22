import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { getUserActivityFeed } from "@/services/roadmap/user-activity";
import {
  assignFeatureOnCanvas,
  notifyFeatureAssignmentRefreshByOrg,
  notifyFeatureReassignmentRefresh,
  unassignFeatureOnCanvas,
} from "@/lib/canvas";
import { loadNodeDetail } from "@/services/orgs/nodeDetail";
import type {
  FeatureProposalMeta,
  MilestoneFeatureMeta,
  Placement,
  ProposalOutput,
} from "@/lib/proposals/types";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  SEND_TO_FEATURE_PLANNER_TOOL,
} from "@/lib/proposals/types";
import { jamieName } from "@/lib/constants/jamie";

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
  "Where to place the new card on the canvas. **Required:** pick " +
  "deliberately based on `read_canvas` output for the canvas this " +
  "card will land on. " +
  "Vocabulary: `auto` (let auto-layout pick), " +
  "`near:<liveId>` / `right-of:<liveId>` (same row, to the right of " +
  "anchor), `left-of:<liveId>` (same row, to the left), " +
  "`below:<liveId>` (start a new row beneath anchor), " +
  "`above:<liveId>` (start a new row above anchor). " +
  "`<liveId>` is the full prefixed id from `read_canvas` (e.g. " +
  "`feature:cmoti7…`, `initiative:cmnxk2…`, `ws:cmoz9c…`). " +
  "Anchor MUST live on the canvas the new card lands on " +
  "(initiative → root canvas; milestone → its parent initiative " +
  "canvas; feature → its initiative canvas if anchored, else its " +
  "workspace canvas). Unresolvable placements (anchor missing, " +
  "wrong canvas, slot collides) silently fall back to `auto` — so " +
  "if you're unsure, use `auto` explicitly.";

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
  /**
   * Pre-validated `SharedConversation.id` for the canvas conversation
   * driving this turn. When `send_to_feature_planner` runs and the
   * targeted feature has no `parentCanvasConversationId` yet, the tool
   * lazy-claims ownership using this id so future planner ASSISTANT
   * messages fan out back to the same canvas conversation
   * (`src/services/canvas-planner-fanout.ts`). Optional — when
   * absent, the lazy-claim short-circuits and the feature stays
   * unowned for fan-out purposes.
   */
  currentCanvasConversationId?: string,
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

    // ─── send_to_feature_planner ─────────────────────────────────────
    // Send a message to a feature's per-feature planning agent (the
    // "plan_mode" Stakwork workflow). This is the canvas agent's
    // primary cross-feature coordination tool: instead of editing a
    // sibling feature's plan text directly, the canvas agent delegates
    // — *the planner writes the plan, the manager only sends messages
    // and reads results.* Mirrors how a real manager works with a
    // team of subordinates.
    //
    // **Fire-and-forget.** The plan agent's reply is asynchronous
    // (Stakwork runs research + synthesis, typically 30–120s). This
    // tool returns immediately once the message lands in the feature's
    // chat history; the agent's reply arrives later as an ASSISTANT
    // ChatMessage carrying a PLAN artifact. To see the reply, call
    // `<slug>__read_feature` afterward — it returns the full plan
    // (`brief`, `requirements`, `architecture`), the live
    // `workflowStatus` / `isWorkflowRunning`, AND the chat history so
    // the canvas agent can see exactly what was decided.
    //
    // **Cannot send while the planner is already running.** If
    // `workflowStatus === "IN_PROGRESS"` the underlying service
    // throws; the canvas agent should wait (call `read_feature`
    // periodically) or message a different feature first.
    //
    // **Attribution.** The message lands in the feature's chat as
    // sent by the canvas chat's user, prefixed with `[Jamie]`
    // so the planner can recognize the cross-feature context.
    // The prompt teaches the agent to lead with the reason it's
    // reaching out (e.g. *"We're aligning auth across three features
    // — please use `userId` as the canonical name."*).
    [SEND_TO_FEATURE_PLANNER_TOOL]: tool({
      description:
        "Send a message to a feature's per-feature planning agent. " +
        "Use this when you need a sibling feature's planner to know " +
        "something or take a decision into account — e.g. *'the " +
        "backend feature picked userId as the canonical name, please " +
        "align the web plan to match'*, *'we decided session timeout " +
        "is 30 minutes — please incorporate'*, or to ask the planner " +
        "a question. **This is delegation, not editing.** You're " +
        "sending a chat message; the planner replies asynchronously " +
        "and updates its own plan. To see the reply and the resulting " +
        "plan, call `<slug>__read_feature` afterward — its response " +
        "includes the current `brief` / `requirements` / " +
        "`architecture` PLUS the full chat history. " +
        "**The tool returns once the message is delivered, NOT once " +
        "the planner replies.** The reply is async. Plan workflows " +
        "typically take 30–120 seconds; don't loop polling. Tell the " +
        "user *'I've sent a message to the X planner; I'll check back " +
        "in a moment'* and move on. " +
        "**Fails if the planner is currently running** " +
        "(`workflowStatus === 'IN_PROGRESS'`). Wait for the run to " +
        "finish (use `<slug>__read_feature` to check) before sending. " +
        "Prefix your message with a one-line reason for context — the " +
        "planner sees this as the chat history's next user message " +
        "and a short framing helps it understand cross-feature " +
        "coordination.",
      inputSchema: z.object({
        featureId: z
          .string()
          .min(1)
          .describe(
            "The cuid of the feature whose planner to message. From a " +
              "canvas live id of the form `feature:<cuid>`, pass just " +
              "the `<cuid>` part.",
          ),
        message: z
          .string()
          .min(1)
          .describe(
            "The message to send to the planner. Lead with a short " +
              "framing of WHY you're reaching out from the canvas " +
              "(cross-feature alignment, propagating a decision, " +
              "etc.) so the planner has context. The system " +
              "automatically prefixes your message with `[Jamie]`" +
              "so the planner can recognize this isn't a " +
              "direct user reply.",
          ),
      }),
      execute: async ({
        featureId,
        message,
      }: {
        featureId: string;
        message: string;
      }) => {
        try {
          // Validate the feature belongs to this org via the workspace
          // → org chain. Same pattern as the other initiative tools.
          // `sendFeatureChatMessage` will additionally verify the chat
          // user (`userId` from `buildInitiativeTools`) is a member
          // or owner of the workspace — the org check here is an
          // extra defense against cross-org leakage.
          // Pull the feature's display fields (title + workspace
          // slug/name) alongside the auth fields. The chat UI uses
          // them to render a `SubAgentRunCard` without re-fetching;
          // mirroring how `propose_feature` returns enough metadata
          // for `ProposalCard` to render off the tool output alone.
          const feature = await db.feature.findUnique({
            where: { id: featureId },
            select: {
              title: true,
              workspaceId: true,
              workflowStatus: true,
              parentCanvasConversationId: true,
              workspace: {
                select: {
                  slug: true,
                  name: true,
                  sourceControlOrgId: true,
                },
              },
            },
          });
          if (!feature) {
            return { error: "Feature not found" };
          }
          if (feature.workspace.sourceControlOrgId !== orgId) {
            return {
              error: "Feature does not belong to this organization",
            };
          }
          // Captured once so both the success and the IN_PROGRESS
          // error path can include them — the UI card needs the title
          // even when the send was rejected, so the user can see
          // *which* planner the agent tried to message.
          const featureTitle = feature.title;
          const workspaceSlug = feature.workspace.slug;
          const workspaceName = feature.workspace.name;
          // Early-return the "already running" case with a clear
          // message so the agent can tell the user without retrying.
          // (The service throws the same error, but catching here lets
          // us return a structured payload instead of an opaque
          // exception.)
          if (feature.workflowStatus === "IN_PROGRESS") {
            return {
              error:
                "The planner is currently running on this feature. " +
                "Use `<slug>__read_feature` to check `workflowStatus` " +
                "and wait until it leaves `IN_PROGRESS` before sending.",
              workflowStatus: feature.workflowStatus,
              featureId,
              featureTitle,
              workspaceSlug,
              workspaceName,
            };
          }

          // Lazy-claim ownership: if this feature was created from a
          // non-canvas surface (per-feature plan page, etc.) it has
          // no parent canvas conversation yet. The first canvas
          // conversation to message its planner claims ownership, so
          // subsequent planner ASSISTANT messages fan out back here
          // (`src/services/canvas-planner-fanout.ts`). Symmetric with
          // the eager-claim that `handleApproval.approveFeature` does
          // on first proposal-approval.
          //
          // Singular ownership (v1): if another canvas conversation
          // already claimed this feature, we do NOT steal the claim.
          // Planner replies will still fan out — to the original
          // owner, not this conversation. See "Future seams" in the
          // plan doc for the join-table promotion path.
          //
          // Non-fatal on failure: the message still goes through; the
          // planner's reply just won't fan out to this conversation.
          if (
            !feature.parentCanvasConversationId &&
            currentCanvasConversationId
          ) {
            try {
              await db.feature.update({
                where: { id: featureId },
                data: { parentCanvasConversationId: currentCanvasConversationId },
              });
            } catch (e) {
              console.error(
                "[send_to_feature_planner] lazy-claim parentCanvasConversationId failed (non-fatal):",
                e,
              );
            }
          }

          // Prefix attribution so the planner knows this came from
          // the canvas agent, not a direct user reply. The planner's
          // prompt can be taught to weigh canvas-agent messages as
          // cross-feature coordination signals.
          const prefixedMessage = `[${jamieName}] ${message}`;

          // `skipOrgContextScout: true` — the canvas agent already
          // has org-wide context (that's why it's reaching out across
          // features). Re-running the org-context scout from inside
          // the per-feature planner would burn 5-60s of latency for
          // information the canvas agent could have included verbatim
          // in `message`. Mirrors the approval-flow's `initialMessage`
          // path (see `handleApproval.ts`).
          const result = await sendFeatureChatMessage({
            featureId,
            userId,
            message: prefixedMessage,
            skipOrgContextScout: true,
          });

          return {
            status: "sent",
            featureId,
            featureTitle,
            workspaceSlug,
            workspaceName,
            messageId: result.chatMessage.id,
            awaitingReply: true,
            stakworkProjectId: result.stakworkData?.projectId ?? null,
            note:
              "Message delivered. The planner replies asynchronously " +
              "(typically 30–120s). Call `<slug>__read_feature` after " +
              "to see the reply and the updated plan.",
          };
        } catch (e) {
          console.error(
            "[initiativeTools.send_to_feature_planner] error:",
            e,
          );
          const message =
            e instanceof Error
              ? e.message
              : "Failed to send message to feature planner";
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

    // ─── propose_feature ─────────────────────────────────────────────
    // Same shape as propose_initiative; validates workspace + (if
    // supplied) initiative / milestone ownership against `orgId` so
    // the agent can't propose into another org by guessing cuids.
    // `parentProposalId` is NOT validated here — the conversation
    // transcript isn't visible to the tool. Approval-time validates it
    // by scanning the conversation for the matching `approvalResult`.
    [PROPOSE_FEATURE_TOOL]: tool({
      description:
        "Propose a new Feature in a specific workspace, normally under " +
        "an existing or proposed initiative. USE THIS whenever the " +
        "user asks you to add, create, draft, sketch, suggest, " +
        "brainstorm, spin up, kick off, set up, plan, build, ship, or " +
        "start a new feature — e.g. 'add a tiered-pricing feature', " +
        "'create me a setup wizard', 'propose 3 features for billing " +
        "v2.' This tool does NOT write to the DB; it emits a " +
        "proposal card in chat that the user explicitly approves " +
        "with a click — approval is what creates the row. Do NOT " +
        "decline feature-creation requests by telling the user to " +
        "use the '+' button. " +
        "**BEFORE calling this tool without an `initiativeId`**, you " +
        "MUST call `read_canvas` (no `ref`, the org root) to see the " +
        "existing initiatives. If any initiative is a reasonable " +
        "semantic fit for the feature, set `initiativeId` to it. " +
        "Loose features (no initiative) should be a last resort when " +
        "no existing initiative matches, NOT the default. Features " +
        "are organized by initiative on the canvas; a fitting " +
        "initiative is almost always preferable to filing the feature " +
        "loose under a workspace. " +
        "**Do NOT set `milestoneId` for new features unless the user " +
        "explicitly asks** — milestones are primarily for grouping " +
        "already-completed work, not for filing new features. Even on " +
        "a milestone canvas, prefer the parent initiative's id as " +
        "`initiativeId` (omit `milestoneId`) unless the user has " +
        "specifically said 'file this under this milestone.' " +
        "To group multiple features under a " +
        "not-yet-approved initiative from this same conversation, set " +
        "`parentProposalId` to that initiative proposal's id; the " +
        "approval handler wires them up automatically. To file a " +
        "feature under an EXISTING initiative, use `initiativeId`. " +
        "**Always provide BOTH `description` and `initialMessage`.** " +
        "`description` is the durable brief (a short paragraph of " +
        "context shown on the feature page). `initialMessage` seeds " +
        "the feature's planning agent: LEAD with a one-line directive " +
        "phrased as an instruction to a developer (e.g. 'Build a " +
        "tiered pricing page with three plans and a comparison " +
        "table'), then FOLD IN any concrete API shapes/contracts, " +
        "data models, types, and integration points you discovered " +
        "while researching this in the conversation — verbatim and " +
        "specific, so the planner builds on what you already learned " +
        "instead of rediscovering it. You can also reference another " +
        "workspace by its `@slug` (from the **Available Workspaces** " +
        "list) to let the planner delegate to that workspace's swarm " +
        "for cross-workspace context. This directive is what kicks " +
        "off research and the feature's eventual auto-naming.",
      inputSchema: z.object({
        proposalId: z.string().min(1),
        title: z.string().min(1),
        description: z
          .string()
          .optional()
          .describe(
            "The durable brief for this feature — a short paragraph " +
              "of context shown on the feature page. Keep it " +
              "high-level; put concrete API contracts and any `@slug` " +
              "workspace references in `initialMessage`, not here. " +
              "Distinct from `initialMessage`, which seeds the " +
              "planning agent.",
          ),
        initialMessage: z
          .string()
          .min(1)
          .describe(
            "The FIRST chat message on the new feature's plan chat " +
              "after approval — it kicks off the planning workflow's " +
              "research pass (which produces the feature's proper " +
              "auto-generated title). Structure it in up to three " +
              "parts: (1) LEAD with a one-line directive phrased as " +
              "an instruction to a developer, e.g. 'Build a tiered " +
              "pricing page with three plans and a comparison table.' " +
              "(2) THEN, whenever your prior research in THIS " +
              "conversation surfaced concrete technical contracts, " +
              "append them verbatim so the planner doesn't have to " +
              "rediscover (or accidentally contradict) them: exact " +
              "API endpoint paths, request/response schemas, data " +
              "models, type definitions, auth/permission requirements, " +
              "and external integration points. Be specific — paste " +
              "the real routes, field names, and types you found, not " +
              "vague summaries. (3) If the feature needs context from " +
              "ANOTHER workspace's codebase (shared types, an API " +
              "another team owns, cross-service contracts), mention " +
              "that workspace by its `@slug` (the slug from the " +
              "**Available Workspaces** list, e.g. `@stakgraph`). A " +
              "mentioned `@slug` attaches that workspace as a " +
              "sub-agent to this planner run, letting the planner " +
              "query that workspace's own swarm / knowledge graph for " +
              "cross-workspace details on demand. Only mention " +
              "workspaces that are genuinely relevant. " +
              "ACCURACY OVER SPEED: only include contracts you " +
              "actually verified via research/tools (the per-workspace " +
              "concept/code agents, `web_search`, or a referenced " +
              "`@slug` workspace's swarm) — never guess or fabricate " +
              "endpoint paths, field names, or types. A made-up " +
              "contract is worse than none: the planner treats the " +
              "seed as ground truth and will build on it. For anything " +
              "you could not verify, say so explicitly and instruct " +
              "the planner to confirm the shape against the real " +
              "codebase before implementing, rather than inventing it. " +
              "Markdown is supported. Required.",
          ),
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "The slug of the workspace this feature lives in (e.g. " +
              "`hive`, `stakgraph`). Required. Use the slug shown in " +
              "the **Available Workspaces** list at the top of the " +
              "system prompt — never an opaque id. When the user is " +
              "on an initiative sub-canvas, the system prompt's " +
              "`Current canvas scope` section names the slug to use; " +
              "follow it.",
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
              "initiative — you don't need to set both. **Rare for " +
              "new features.** Milestones primarily group completed " +
              "work; only set this when the user has explicitly asked " +
              "to file the new feature under a specific milestone. " +
              "Default: omit and use `initiativeId` instead.",
          ),
        parentProposalId: z
          .string()
          .optional()
          .describe(
            "Id of a sibling `propose_initiative` call in this " +
              "conversation. Approval-time resolves this to the new " +
              "initiative's id once the parent has been approved.",
          ),
        dependsOnFeatureIds: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Cuids of features that ALREADY EXIST in the DB and must " +
              "reach completion before this feature can start. " +
              "Discover them via `read_canvas` (live ids are " +
              "`feature:<cuid>` — pass just the `<cuid>` part) or " +
              "`<slug>__list_features`. Validated at propose-time: " +
              "every id must exist and belong to this org. " +
              "**NEVER pass a `proposalId` here.** Sibling proposals " +
              "from this same chat go in `dependsOnProposalIds` " +
              "instead — they have no DB row yet and would fail " +
              "this validation. At approval time, this array is " +
              "unioned with the cuids resolved from " +
              "`dependsOnProposalIds` and written to " +
              "`Feature.dependsOnFeatureIds`.",
          ),
        dependsOnProposalIds: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "`proposalId`s of OTHER `propose_feature` calls in this " +
              "same conversation (typically siblings under the same " +
              "initiative). NOT cuids — these ids only exist in the " +
              "chat transcript. At approval time the handler scans " +
              "the conversation for each id's " +
              "`approvalResult.createdEntityId` and unions the " +
              "results with `dependsOnFeatureIds`. If a referenced " +
              "proposal hasn't been approved yet, approval of THIS " +
              "proposal fails with *'Approve the blocker first.'* " +
              "**NEVER pass a cuid here.** Existing-DB features go " +
              "in `dependsOnFeatureIds`.",
          ),
        rationale: z.string().optional(),
        placement: placementSchema.describe(PLACEMENT_DESCRIPTION),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        try {
          // Seed the auto-respond default from the calling user's global
          // preference. The ProposalCard toggle lets the user override
          // this before approving; the value is forwarded unconditionally
          // in the approval intent so `false` is never silently dropped.
          const callingUser = await db.user.findUnique({
            where: { id: userId },
            select: { canvasAutonomousTurns: true },
          });
          const autoRespondDefault = callingUser?.canvasAutonomousTurns ?? false;

          // Resolve slug → cuid + validate workspace ↔ org ownership.
          // The agent works in slugs (human-readable, surfaced in the
          // prompt and in tool prefixes); the DB and stored proposal
          // payload work in cuids. Resolution lives here so the agent
          // never needs to see or echo a cuid for a workspace.
          // We also fetch `name` so the proposal card can render the
          // human-readable workspace name in its subtext (see
          // `FeatureProposalMeta` — names beat cuid suffixes).
          const workspace = await db.workspace.findFirst({
            where: {
              slug: input.workspaceSlug,
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
          const resolvedWorkspaceId = workspace.id;

          // If initiativeId is supplied, confirm it lives under this
          // org. Milestones get validated transitively (via the
          // milestone → initiative → org chain). Both selects also
          // pull `name` for the card's render-only `meta` block.
          let initiativeName: string | undefined;
          if (input.initiativeId) {
            const initiative = await db.initiative.findFirst({
              where: { id: input.initiativeId, orgId },
              select: { id: true, name: true },
            });
            if (!initiative) {
              return {
                error: "Initiative not found in this organization.",
              };
            }
            initiativeName = initiative.name;
          }
          let milestoneName: string | undefined;
          if (input.milestoneId) {
            const milestone = await db.milestone.findFirst({
              where: {
                id: input.milestoneId,
                initiative: { orgId },
              },
              select: {
                id: true,
                name: true,
                initiativeId: true,
                // Pull the parent initiative's name too so we can fill
                // in `meta.initiativeName` even when the agent only
                // supplied `milestoneId` (initiative is derived).
                initiative: { select: { name: true } },
              },
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
            milestoneName = milestone.name;
            // Derive initiative name from the milestone when the agent
            // only sent `milestoneId`. Cheap, and keeps the card's
            // subtext consistent regardless of which the agent passed.
            if (!initiativeName) {
              initiativeName = milestone.initiative.name;
            }
          }

          if (input.initiativeId && input.parentProposalId) {
            return {
              error:
                "Pass either `initiativeId` (existing) or `parentProposalId` (proposed-in-this-chat), not both.",
            };
          }

          // ─── Dependency-field validation ────────────────────────
          // `dependsOnFeatureIds` carries existing-DB cuids. Validate
          // shape (looks-like-a-cuid) so the agent's most common
          // confusion — passing a `proposalId` like `"f-backend"` —
          // fails here with a clear message pointing at the right
          // field, rather than silently failing at approval time.
          //
          // Then validate ownership: every id must exist and live in
          // a workspace owned by this org. Same query pattern as the
          // existing initiative/workspace org-ownership checks.
          //
          // `dependsOnProposalIds` we deliberately DON'T validate
          // here — the conversation transcript isn't available to the
          // tool, so we can't tell if a referenced proposalId is in
          // this chat. Approval-time handles it.
          const dedupedDependsOnFeatureIds =
            input.dependsOnFeatureIds && input.dependsOnFeatureIds.length > 0
              ? Array.from(new Set(input.dependsOnFeatureIds))
              : [];
          if (dedupedDependsOnFeatureIds.length > 0) {
            // Cheap shape check: cuids start with `c` and are ~25 chars.
            // Catches the proposalId-in-wrong-field case (`"f-backend"`
            // doesn't match).
            const looksWrong = dedupedDependsOnFeatureIds.filter(
              (id) => !/^c[a-z0-9]{20,}$/.test(id),
            );
            if (looksWrong.length > 0) {
              return {
                error:
                  "`dependsOnFeatureIds` expects DB cuids (e.g. " +
                  "`cmpqr…`), but received: " +
                  looksWrong.join(", ") +
                  ". If these are sibling-proposal ids from this chat, " +
                  "pass them in `dependsOnProposalIds` instead.",
              };
            }
            const existing = await db.feature.findMany({
              where: {
                id: { in: dedupedDependsOnFeatureIds },
                deleted: false,
                workspace: { sourceControlOrgId: orgId },
              },
              select: { id: true },
            });
            if (existing.length !== dedupedDependsOnFeatureIds.length) {
              const found = new Set(existing.map((f) => f.id));
              const missing = dedupedDependsOnFeatureIds.filter(
                (id) => !found.has(id),
              );
              return {
                error:
                  "Feature(s) not found in this organization: " +
                  missing.join(", "),
              };
            }
          }

          const dedupedDependsOnProposalIds =
            input.dependsOnProposalIds && input.dependsOnProposalIds.length > 0
              ? Array.from(new Set(input.dependsOnProposalIds))
              : [];
          // Self-reference: a proposal pointing at itself via
          // `dependsOnProposalIds` is always a cycle.
          if (dedupedDependsOnProposalIds.includes(input.proposalId)) {
            return {
              error:
                "A proposal cannot depend on itself (self-reference in `dependsOnProposalIds`).",
            };
          }

          const meta: FeatureProposalMeta = {
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
            ...(initiativeName && { initiativeName }),
            ...(milestoneName && { milestoneName }),
          };

          return {
            kind: "feature",
            proposalId: input.proposalId,
            payload: {
              title: input.title,
              ...(input.description && { description: input.description }),
              initialMessage: input.initialMessage,
              // Stored payload uses the cuid (downstream
              // `createFeature` and the approval handler expect an
              // id). The agent only sees / sends slugs.
              workspaceId: resolvedWorkspaceId,
              ...(input.initiativeId && {
                initiativeId: input.initiativeId,
              }),
              ...(input.milestoneId && { milestoneId: input.milestoneId }),
              ...(input.parentProposalId && {
                parentProposalId: input.parentProposalId,
              }),
              ...(dedupedDependsOnFeatureIds.length > 0 && {
                dependsOnFeatureIds: dedupedDependsOnFeatureIds,
              }),
              ...(dedupedDependsOnProposalIds.length > 0 && {
                dependsOnProposalIds: dedupedDependsOnProposalIds,
              }),
              ...(input.placement && {
                placement: input.placement as Placement,
              }),
              autoRespond: autoRespondDefault,
            },
            meta,
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
