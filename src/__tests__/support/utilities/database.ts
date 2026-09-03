/**
 * Database utilities for test setup and cleanup
 */
import { db } from "@/lib/db";

export async function countWorkspaces(): Promise<number> {
  return db.workspace.count();
}

export async function countWorkspaceMembers(
  workspaceId: string,
): Promise<number> {
  return db.workspaceMember.count({
    where: { workspaceId, leftAt: null },
  });
}

export async function getWorkspaceWithRelations(workspaceId: string) {
  return db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: true,
      members: {
        where: { leftAt: null },
        include: { user: true },
      },
      swarm: true,
      products: true,
    },
  });
}

export async function workspaceSlugExists(slug: string): Promise<boolean> {
  const workspace = await db.workspace.findUnique({
    where: { slug },
  });

  return Boolean(workspace);
}

export async function deleteWorkspace(workspaceId: string) {
  await db.workspace.delete({
    where: { id: workspaceId },
  });
}

export async function deleteUser(userId: string) {
  await db.user.delete({
    where: { id: userId },
  });
}

export async function deleteWorkspaces(workspaceIds: string[]) {
  await db.workspace.deleteMany({
    where: { id: { in: workspaceIds } },
  });
}

export async function deleteUsers(userIds: string[]) {
  await db.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

export const cleanup = {
  deleteWorkspace,
  deleteWorkspaces,
  deleteUser,
  deleteUsers,
  resetDatabase,
};

export async function resetDatabase() {
  try {
    await db.screenshot.deleteMany();
    await db.attachment.deleteMany();
    await db.artifact.deleteMany();
    await db.chatMessage.deleteMany();
    await db.deployment.deleteMany();
    // notificationTrigger may not exist in older schema versions; swallow if missing
    try { await db.notificationTrigger.deleteMany(); } catch { /* table may not exist */ }
    await db.workflowTask.deleteMany();
    await db.task.deleteMany();
    await db.janitorRecommendation.deleteMany();
    await db.janitorRun.deleteMany();
    await db.janitorConfig.deleteMany();
    await db.userStory.deleteMany();
    await db.userFeaturePresence.deleteMany();
    try { await db.scorerDigest.deleteMany(); } catch { /* table may not exist */ }
    // LegalBenchmarkRun table was dropped in migration 20260706201300 — runs now tracked as StakworkRun
    // agentLog/stakworkRun have nullable feature FKs without onDelete:Cascade;
    // delete them before features to avoid FK constraint violations.
    try { await db.agentLog.deleteMany(); } catch { /* table may not exist */ }
    try { await db.stakworkRun.deleteMany(); } catch { /* table may not exist */ }
    try { await db.whiteboard.deleteMany(); } catch { /* table may not exist */ }
    try { await db.htmlPage.deleteMany(); } catch { /* table may not exist */ }
    await db.phase.deleteMany();
    await db.feature.deleteMany();
    await db.repository.deleteMany();
    await db.pod.deleteMany();
    await db.swarm.deleteMany();
    await db.workspaceTransaction.deleteMany();
    await db.lightningPayment.deleteMany();
    await db.fiatPayment.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.prompt.deleteMany();
    await db.promptVersion.deleteMany();
    await db.promptDailyRun.deleteMany();
    await db.promptUsage.deleteMany();
    await db.llmModel.deleteMany();
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.gitHubAuth.deleteMany();
    await db.sourceControlToken.deleteMany();
    await db.sourceControlOrg.deleteMany();
    await db.user.deleteMany();
  } catch {
    await aggressiveReset();
  }
}

/**
 * Tables the aggressive path truncates, ordered child-first for readability.
 * `TRUNCATE ... CASCADE` also empties any table that references one of these,
 * so the list does not have to be exhaustive.
 */
const RESET_TABLES = [
  "screenshots",
  "attachments",
  "artifacts",
  "chat_messages",
  "deployments",
  "notification_triggers",
  "workflow_tasks",
  "tasks",
  "janitor_recommendations",
  "janitor_runs",
  "janitor_configs",
  "agent_logs",
  "stakwork_runs",
  "whiteboards",
  "user_stories",
  "user_feature_presence",
  "scorer_digests",
  "legal_benchmark_runs",
  "phases",
  "features",
  "repositories",
  "pods",
  "swarms",
  "workspace_transactions",
  "lightning_payments",
  "fiat_payments",
  "workspace_members",
  "workspaces",
  "llm_models",
  "sessions",
  "accounts",
  "github_auth",
  "users",
  "source_control_tokens",
  "source_control_orgs",
  "prompt_versions",
  "prompt_daily_runs",
  "prompt_usages",
  "prompts",
];

/**
 * Fallback reset: one `TRUNCATE ... CASCADE` over every table that exists.
 *
 * This must NOT reach for `SET session_replication_role = replica`. That GUC
 * is per-CONNECTION, and Prisma runs each raw query on whatever pooled
 * connection is free — so the `SET` and its matching reset can land on
 * different connections, leaving one stuck in replica mode for the rest of
 * the run. Postgres implements foreign keys as system triggers, which replica
 * mode skips, so any later query served by that connection silently loses FK
 * enforcement AND referential actions: `prompt.delete()` succeeds while its
 * `onDelete: Cascade` versions survive as orphans. The integration suite
 * shares one client and one pool across all files (vitest `singleThread`), so
 * a single poisoned connection produces failures in unrelated files far later
 * in the run.
 *
 * `TRUNCATE ... CASCADE` needs no such hack: it follows FK dependencies on its
 * own, in a single statement on a single connection.
 */
async function aggressiveReset() {
  let existing: Array<{ tablename: string }>;
  try {
    existing = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema()
        AND tablename = ANY(${RESET_TABLES})
    `;
  } catch {
    // Engine not yet connected — nothing to reset, return silently
    return;
  }

  if (existing.length === 0) return;

  const list = existing.map((t) => `"${t.tablename}"`).join(", ");
  try {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE;`);
  } catch {
    // Best-effort: the ordered deleteMany path above is the primary reset.
  }
}
