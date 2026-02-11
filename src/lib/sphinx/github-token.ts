import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

/**
 * Get a GitHub token from any admin/owner of the workspace who has
 * a SourceControlToken for the workspace's SourceControlOrg.
 */
export async function getWorkspaceAdminGithubToken(workspaceSlug: string): Promise<string | null> {
  const workspace = await db.workspace.findUnique({
    where: { slug: workspaceSlug },
    include: {
      sourceControlOrg: true,
      members: {
        where: { role: { in: ["OWNER", "ADMIN"] } },
        select: { userId: true },
      },
    },
  });

  if (!workspace?.sourceControlOrg) {
    return null;
  }

  const encryptionService = EncryptionService.getInstance();

  // Try each admin until we find one with a valid token
  for (const member of workspace.members) {
    const sourceControlToken = await db.sourceControlToken.findUnique({
      where: {
        userId_sourceControlOrgId: {
          userId: member.userId,
          sourceControlOrgId: workspace.sourceControlOrg.id,
        },
      },
    });

    if (sourceControlToken?.token) {
      try {
        const decrypted = encryptionService.decryptField("source_control_token", sourceControlToken.token);
        return decrypted;
      } catch (_error) {
        // Token decryption failed, try next admin
        continue;
      }
    }
  }

  return null;
}
