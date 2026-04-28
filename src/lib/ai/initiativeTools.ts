import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap";
import { notifyFeatureReassignmentRefresh } from "@/services/roadmap/feature-canvas-notify";

/**
 * Tools for managing the live, DB-backed roadmap relationships that
 * the org canvas projects (initiatives ↔ milestones ↔ features).
 *
 * Today there is exactly one tool: `assign_feature_to_initiative`.
 * Creation of features, initiatives, and milestones stays human-only
 * (handled by the canvas `+` menu and dialogs). The agent's role is
 * to *organize* — link existing features into the initiative/milestone
 * hierarchy when the user asks "add these features to my new initiative."
 *
 * Discovery: the agent already has per-workspace `<slug>__list_features`
 * tools (see `askToolsMulti.ts`). It should fan out across those to
 * find candidate features, then call this tool to attach them.
 *
 * Validation: every mutation verifies the feature's workspace belongs
 * to the supplied org, so an agent invoked under org A can never
 * reassign a feature in org B even if it guesses a featureId. The
 * underlying `updateFeature` service then enforces the
 * `feature.initiativeId === milestone.initiativeId` invariant the
 * canvas projectors rely on.
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
  };
}
