import { db } from "@/lib/db";

export interface FeatureContext {
  feature: {
    /**
     * Feature cuid. Exposed to the plan agent so it can pass this id
     * to the workspace-scope MCP tools (`list_tasks` with featureId
     * filter, `create_task` with feature attachment, `update_task`,
     * `send_to_task_agent`). Without this, the plan agent would have
     * no way to scope its task operations to its own feature.
     */
    id: string;
    title: string;
    brief: string | null;
    userStories: string[];
    requirements: string | null;
    architecture: string | null;
  };
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
    currentPhase: {
      name: phase.name,
      description: phase.description,
      tickets: phase.tasks,
    },
  };
}
