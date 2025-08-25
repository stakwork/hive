import { db } from "@/lib/db";
import { JanitorType, RecommendationStatus } from "@prisma/client";

/**
 * Check if there are too many pending recommendations for a specific janitor type and workspace
 */
export async function hasTooManyPendingRecommendations(
  janitorConfigId: string, 
  janitorType: JanitorType,
  maxPendingRecommendations: number = 5
): Promise<boolean> {
  // First get all run IDs for this config and type
  const runs = await db.janitorRun.findMany({
    where: {
      janitorConfigId,
      janitorType
    },
    select: { id: true }
  });
  
  if (runs.length === 0) {
    console.log(`[Janitor] No previous runs for ${janitorType} in config ${janitorConfigId}`);
    return false;
  }
  
  const runIds = runs.map(r => r.id);
  console.log(`[Janitor] Found ${runs.length} runs for ${janitorType}: ${runIds.join(', ')}`);
  
  // Then count pending recommendations for those runs
  const pendingCount = await db.janitorRecommendation.count({
    where: {
      janitorRunId: { in: runIds },
      status: RecommendationStatus.PENDING
    }
  });
  
  // Also get a sample of pending recommendations for debugging
  const samplePending = await db.janitorRecommendation.findMany({
    where: {
      janitorRunId: { in: runIds },
      status: RecommendationStatus.PENDING
    },
    take: 5,
    select: { id: true, title: true, janitorRunId: true }
  });
  
  console.log(`[Janitor] Pending recommendations for ${janitorType} in config ${janitorConfigId}: ${pendingCount} (from ${runs.length} runs)`);
  if (samplePending.length > 0) {
    console.log(`[Janitor] Sample pending recommendations:`, samplePending.map(r => `${r.title} (run: ${r.janitorRunId})`).join(', '));
  }
  
  return pendingCount >= maxPendingRecommendations;
}