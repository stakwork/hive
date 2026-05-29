import { db } from "@/lib/db";

export interface FeatureContext {
  feature: {
    /**
     * Feature cuid. Exposed to the plan agent so it can pass this id
     * to the workspace-scope MCP tools (`list_tasks` with featureId
     * filter, `create_feature_task` / `create_workflow_task`,
     * `update_task`, `send_to_task_agent`). Without this, the plan
     * agent would have no way to scope its task operations to its
     * own feature.
     */
    id: string;
    title: string;
    brief: string | null;
    userStories: string[];
    requirements: string | null;
    architecture: string | null;
  };
  /**
   * Repositories attached to this feature's workspace. Exposed to the
   * plan agent so it can pick a target repo when creating coding
   * tasks via `create_feature_task` (which accepts either
   * `repositoryId` or `repositoryUrl`). When the workspace has a
   * single repo this list still ships — it's cheap and lets the
   * agent verify it picked the right one. Empty array when the
   * workspace has no repos (workflow-only workspaces are possible
   * but rare).
   */
  workspaceRepositories: Array<{
    id: string;
    name: string;
    repositoryUrl: string;
    branch: string;
  }>;
  currentPhase: {
    name: string;
    description: string | null;
    tickets: Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      summary: string | null;
    }>;
  };
  /**
   * Free-form prose describing high-level organizational context that
   * may be relevant for planning this feature. Populated by the
   * plan-mode org-context scout (`scoutOrgContext`) on the first
   * message of a plan; absent on subsequent turns and on the task-mode
   * code path (which doesn't scout). When present, the planning agent
   * is expected to read it as additional grounding alongside the
   * feature's own fields.
   *
   * Not set by `buildFeatureContext` itself — the scout is plan-mode
   * specific and lives in `sendFeatureChatMessage`. This field is
   * here so callers can augment the returned object without losing
   * type safety.
   */
  orgContext?: string;
}

/**
 * Build feature context JSON for Stakwork workflow
 * Used by task coordinator cron and manual task starts
 */
export async function buildFeatureContext(
  featureId: string,
  phaseId: string
): Promise<FeatureContext> {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    include: {
      userStories: {
        orderBy: { order: "asc" },
      },
      workspace: {
        select: {
          repositories: {
            select: {
              id: true,
              name: true,
              repositoryUrl: true,
              branch: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  const phase = await db.phase.findUnique({
    where: { id: phaseId },
    include: {
      tasks: {
        where: { deleted: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          summary: true,
        },
      },
    },
  });

  if (!feature || !phase) {
    throw new Error(`Feature or Phase not found: ${featureId}, ${phaseId}`);
  }

  return {
    feature: {
      id: feature.id,
      title: feature.title,
      brief: feature.brief,
      userStories: feature.userStories.map((us) => us.title),
      requirements: feature.requirements,
      architecture: feature.architecture,
    },
    // `workspace?.repositories` rather than `workspace.repositories` so the
    // function stays well-defined when older mocks / fixtures don't eager-
    // load the join. Real DB rows always have a workspace (FK is non-null),
    // so this is defensive, not load-bearing.
    workspaceRepositories: (feature.workspace?.repositories ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      repositoryUrl: r.repositoryUrl,
      branch: r.branch,
    })),
    currentPhase: {
      name: phase.name,
      description: phase.description,
      tickets: phase.tasks,
    },
  };
}
