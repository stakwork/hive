import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap";
import { notifyFeatureReassignmentRefresh } from "@/services/roadmap/feature-canvas-notify";
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
export function buildInitiativeTools(orgId: string, userId: string): ToolSet {
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
        "context shown on the feature page). `initialMessage` is a " +
        "one-sentence directive that seeds the feature's planning " +
        "agent — it should read like an instruction to a developer, " +
        "e.g. 'Build a tiered pricing page with three plans and a " +
        "comparison table' — that's what kicks off research and the " +
        "feature's eventual auto-naming.",
      inputSchema: z.object({
        proposalId: z.string().min(1),
        title: z.string().min(1),
        description: z
          .string()
          .optional()
          .describe(
            "The durable brief for this feature — a short paragraph " +
              "of context shown on the feature page. Distinct from " +
              "`initialMessage`, which seeds the planning agent.",
          ),
        initialMessage: z
          .string()
          .min(1)
          .describe(
            "One-sentence directive (what should be created) that " +
              "becomes the FIRST chat message on the new feature's " +
              "plan chat after approval. This is what kicks off the " +
              "planning workflow's research pass — research is what " +
              "ultimately produces the feature's proper auto-generated " +
              "title. Phrase it as an instruction to a developer, e.g. " +
              "'Build a tiered pricing page with three plans and a " +
              "comparison table.' Required.",
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
        rationale: z.string().optional(),
        placement: placementSchema.describe(PLACEMENT_DESCRIPTION),
      }),
      execute: async (input): Promise<ProposalOutput | { error: string }> => {
        try {
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
              ...(input.placement && {
                placement: input.placement as Placement,
              }),
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
  };
}
