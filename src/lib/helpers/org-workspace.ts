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
