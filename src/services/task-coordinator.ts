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
    }>;
  };
  /**
   * Optional task summary for live mode workflows
   * Provides additional context about the specific task being executed
   */
  taskSummary?: string;
}

/**
 * Build feature context JSON for Stakwork workflow
 * Used by task coordinator cron and manual task starts
 * 
 * @param featureId - The feature ID to fetch context for
 * @param phaseId - The phase ID to fetch context for
 * @param taskSummary - Optional task summary to include in context (only added if non-empty)
 */
export async function buildFeatureContext(
  featureId: string,
  phaseId: string,
  taskSummary?: string | null
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
        },
      },
    },
  });

  if (!feature || !phase) {
    throw new Error(`Feature or Phase not found: ${featureId}, ${phaseId}`);
  }

  const context: FeatureContext = {
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

  // Add task summary if provided and non-empty
  if (taskSummary && taskSummary.trim()) {
    context.taskSummary = taskSummary;
  }

  return context;
}
