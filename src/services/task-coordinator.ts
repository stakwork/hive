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
