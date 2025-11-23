import { db } from "@/lib/db";

/**
 * Clean up janitor-related test data in the correct order to respect foreign key constraints.
 * This is a shared cleanup utility for janitor cron and related integration tests.
 * 
 * Order of deletion:
 * 1. JanitorRecommendation (has FK to JanitorRun)
 * 2. JanitorRun (has FK to JanitorConfig)
 * 3. JanitorConfig (has FK to Workspace)
 * 4. Task (has FK to Workspace)
 * 5. Swarm (has FK to Workspace)
 * 6. Repository (has FK to Workspace)
 * 7. WorkspaceMember (has FK to Workspace and User)
 * 8. Workspace
 * 9. User (should be last)
 */
export async function cleanupJanitorTestData() {
  await db.janitorRecommendation.deleteMany({});
  await db.janitorRun.deleteMany({});
  await db.janitorConfig.deleteMany({});
  await db.task.deleteMany({});
  await db.swarm.deleteMany({});
  await db.repository.deleteMany({});
  await db.workspaceMember.deleteMany({});
  await db.workspace.deleteMany({});
  await db.user.deleteMany({});
}
