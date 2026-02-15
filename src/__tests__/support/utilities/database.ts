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
    await db.task.deleteMany();
    await db.janitorRecommendation.deleteMany();
    await db.janitorRun.deleteMany();
    await db.janitorConfig.deleteMany();
    await db.repository.deleteMany();
    await db.pod.deleteMany();
    await db.swarm.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
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

async function aggressiveReset() {
  await db.$executeRaw`SET session_replication_role = replica;`;

  try {
    const tables = [
      "screenshots",
      "attachments",
      "artifacts",
      "chat_messages",
      "deployments",
      "tasks",
      "janitor_recommendations",
      "janitor_runs",
      "janitor_configs",
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
    await db.$executeRaw`SET session_replication_role = DEFAULT;`;
  }
}
