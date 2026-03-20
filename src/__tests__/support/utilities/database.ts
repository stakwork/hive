/**
 * Database utilities for test setup and cleanup
 */
import { db } from "@/lib/db";

export async function countWorkspaces(): Promise<number> {
  return db.workspaces.count();
}

export async function countWorkspaceMembers(
  workspaceId: string,
): Promise<number> {
  return db.workspace_members.count({
    where: { workspaceId,left_at: null },
  });
}

export async function getWorkspaceWithRelations(workspaceId: string) {
  return db.workspaces.findUnique({
    where: { id: workspaceId },
    include: {
      owner: true,
      members: {
        where: {left_at: null },
        include: { user: true },
      },
      swarm: true,
      products: true,
    },
  });
}

export async function workspaceSlugExists(slug: string): Promise<boolean> {
  const workspace = await db.workspaces.findUnique({
    where: { slug },
  });

  return Boolean(workspace);
}

export async function deleteWorkspace(workspaceId: string) {
  await db.workspaces.delete({
    where: { id: workspaceId },
  });
}

export async function deleteUser(userId: string) {
  await db.users.delete({
    where: { id: userId },
  });
}

export async function deleteWorkspaces(workspaceIds: string[]) {
  await db.workspaces.deleteMany({
    where: { id: { in: workspaceIds } },
  });
}

export async function deleteUsers(userIds: string[]) {
  await db.users.deleteMany({
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
    await db.screenshots.deleteMany();
    await db.attachments.deleteMany();
    await db.artifacts.deleteMany();
    await db.chat_messages.deleteMany();
    await db.deployments.deleteMany();
    // notificationTrigger may not exist in older schema versions; swallow if missing
    try { await db.notification_triggers.deleteMany(); } catch { /* table may not exist */ }
    await db.tasks.deleteMany();
    await db.janitor_recommendations.deleteMany();
    await db.janitor_runs.deleteMany();
    await db.janitor_configs.deleteMany();
    await db.repositories.deleteMany();
    await db.pods.deleteMany();
    await db.swarms.deleteMany();
    await db.workspace_members.deleteMany();
    await db.workspaces.deleteMany();
    await db.sessions.deleteMany();
    await db.accounts.deleteMany();
    await db.github_auth.deleteMany();
    await db.source_control_tokens.deleteMany();
    await db.source_control_orgs.deleteMany();
    await db.users.deleteMany();
  } catch {
    await aggressiveReset();
  }
}

async function aggressiveReset() {
  try {
    await db.$executeRaw`SET session_replication_role = replica;`;
  } catch {
    // Engine not yet connected — nothing to reset, return silently
    return;
  }

  try {
    const tables = [
      "screenshots",
      "attachments",
      "artifacts",
      "chat_messages",
      "deployments",
      "notification_triggers",
      "tasks",
      "janitor_recommendations",
      "janitor_runs",
      "janitor_configs",
      "user_stories",
      "phases",
      "features",
      "repositories",
      "pods",
      "swarms",
      "workspace_members",
      "workspaces",
      "sessions",
      "accounts",
      "github_auth",
      "users",
      "source_control_tokens",
      "source_control_orgs",
    ];

    for (const table of tables) {
      try {
        await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      } catch {
        // Some tables may not exist in certain schemas; ignore.
      }
    }
  } finally {
    try {
      await db.$executeRaw`SET session_replication_role = DEFAULT;`;
    } catch {
      // Ignore reset failure if engine disconnected
    }
  }
}
