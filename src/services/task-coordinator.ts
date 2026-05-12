import { db } from "@/lib/db";

export interface FeatureContext {
  feature: {
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
