/**
 * Resolve the default workspace for a SourceControlOrg.
 *
 * Used by background cron jobs (e.g. canvas-mirror-cron) that need to push
 * org-scoped data into the org's home swarm. Returns null (never throws) when
 * the org has no defaultWorkspaceId or the linked workspace has no swarm.
 */

import { db } from "@/lib/db";

export interface OrgDefaultWorkspace {
  id: string;
  slug: string;
}

/**
 * Resolves the default workspace + swarm for an org by its cuid.
 * Returns `{ id, slug }` or `null` (org has no default workspace, or
 * the workspace has no swarm configured).
 */
export async function getDefaultWorkspaceForOrg(
  orgId: string,
): Promise<OrgDefaultWorkspace | null> {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: {
        defaultWorkspaceId: true,
        defaultWorkspace: {
          select: {
            id: true,
            slug: true,
            swarm: { select: { id: true } },
          },
        },
      },
    });

    if (!org?.defaultWorkspaceId || !org.defaultWorkspace) return null;
    // Skip if the workspace has no swarm — the mirror cron needs a swarm to push to.
    if (!org.defaultWorkspace.swarm) return null;

    return { id: org.defaultWorkspace.id, slug: org.defaultWorkspace.slug };
  } catch {
    return null;
  }
}

/**
 * Resolves the org's default workspace (with its swarm) for the Advisor
 * embed, by githubLogin.
 *
 * Deliberately has NO membership filter and NO fallback to other
 * workspaces — unlike `resolveOrgSwarmWorkspaceForUser`, whose unordered
 * `findFirst` fallback would hand an Admin of some other workspace a
 * different swarm's advisor (and the answer would vary between requests).
 * The Advisor must always resolve to the org's one default-workspace swarm,
 * or not at all. Returns `null` when the org has no default workspace, the
 * workspace is missing/deleted, or it has no swarm.
 */
export async function resolveOrgDefaultSwarmWorkspace(githubLogin: string) {
  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { defaultWorkspaceId: true },
  });

  if (!org?.defaultWorkspaceId) return null;

  const workspace = await db.workspace.findFirst({
    where: { id: org.defaultWorkspaceId, deleted: false },
    include: { swarm: true },
  });

  if (!workspace?.swarm) return null;

  return workspace;
}

/**
 * Pick the workspace whose swarm backs an org-level embedded view (gateway,
 * strut) for this user: the org's default workspace when it is set, has a
 * swarm, and the user can access it; otherwise the first workspace in the
 * org that does. One resolver so every embedded view lands on the same swarm.
 */
export async function resolveOrgSwarmWorkspaceForUser(
  githubLogin: string,
  userId: string,
) {
  const accessibleWithSwarm = {
    deleted: false,
    sourceControlOrg: { githubLogin },
    OR: [
      { ownerId: userId },
      { members: { some: { userId, leftAt: null } } },
    ],
    swarm: { isNot: null },
  };

  const orgRow = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { defaultWorkspaceId: true },
  });

  if (orgRow?.defaultWorkspaceId) {
    const defaultWorkspace = await db.workspace.findFirst({
      where: { id: orgRow.defaultWorkspaceId, ...accessibleWithSwarm },
      include: { swarm: true },
    });
    if (defaultWorkspace) return defaultWorkspace;
  }

  return db.workspace.findFirst({
    where: accessibleWithSwarm,
    include: { swarm: true },
  });
}
