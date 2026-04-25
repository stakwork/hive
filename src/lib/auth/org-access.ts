import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

/**
 * Returns the `SourceControlOrg.id` for the given `githubLogin` iff the user
 * has membership in at least one workspace under that org. When
 * `requireAdmin` is true, the user must own or be an ADMIN of at least one
 * such workspace.
 *
 * Returns null if the org doesn't exist or the user has no qualifying
 * workspace — callers should translate this into a unified 404 so we
 * don't leak org existence.
 */
export async function resolveAuthorizedOrgId(
  githubLogin: string,
  userId: string,
  requireAdmin: boolean,
): Promise<string | null> {
  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) return null;

  const adminRoles: WorkspaceRole[] = [WorkspaceRole.ADMIN];

  const workspace = await db.workspace.findFirst({
    where: {
      deleted: false,
      sourceControlOrgId: org.id,
      OR: [
        // Owners always qualify — including for admin-gated actions.
        { ownerId: userId },
        {
          members: {
            some: {
              userId,
              leftAt: null,
              ...(requireAdmin ? { role: { in: adminRoles } } : {}),
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (!workspace) return null;
  return org.id;
}
