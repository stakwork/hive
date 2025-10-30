import { db } from "@/lib/db";
import type { SourceControlOrg, SourceControlToken } from "@prisma/client";

export interface CreateTestSourceControlOrgOptions {
  githubLogin: string;
  githubInstallationId: number;
  type?: "ORG" | "USER";
  name?: string;
}

export interface CreateTestSourceControlTokenOptions {
  userId: string;
  sourceControlOrgId: string;
  token?: string;
  refreshToken?: string;
  scopes?: string[];
}

/**
 * Creates a test SourceControlOrg representing a GitHub organization or user
 */
export async function createTestSourceControlOrg(
  options: CreateTestSourceControlOrgOptions,
): Promise<SourceControlOrg> {
  return db.sourceControlOrg.create({
    data: {
      githubLogin: options.githubLogin,
      githubInstallationId: options.githubInstallationId,
      type: options.type || "ORG",
      name: options.name || `${options.githubLogin} Organization`,
    },
  });
}

/**
 * Creates a test SourceControlToken for a user within a SourceControlOrg
 */
export async function createTestSourceControlToken(
  options: CreateTestSourceControlTokenOptions,
): Promise<SourceControlToken> {
  return db.sourceControlToken.create({
    data: {
      userId: options.userId,
      sourceControlOrgId: options.sourceControlOrgId,
      token: options.token || "encrypted-token",
      refreshToken: options.refreshToken || "encrypted-refresh-token",
      scopes: options.scopes || ["repo"],
    },
  });
}

/**
 * Links a workspace to a SourceControlOrg
 */
export async function linkWorkspaceToSourceControlOrg(
  workspaceId: string,
  sourceControlOrgId: string,
): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { sourceControlOrgId },
  });
}

export interface CreateGitHubSetupOptions {
  workspaceId: string;
  userId: string;
  githubLogin: string;
  githubInstallationId: number;
  withToken?: boolean;
  type?: "ORG" | "USER";
}

/**
 * Creates a complete GitHub setup: org, token (optional), and workspace link
 * This is a convenience function for common test scenarios
 */
export async function createGitHubSetup(
  options: CreateGitHubSetupOptions,
): Promise<{ org: SourceControlOrg; token: SourceControlToken | null }> {
  const org = await createTestSourceControlOrg({
    githubLogin: options.githubLogin,
    githubInstallationId: options.githubInstallationId,
    type: options.type,
  });

  await linkWorkspaceToSourceControlOrg(options.workspaceId, org.id);

  let token: SourceControlToken | null = null;
  if (options.withToken !== false) {
    token = await createTestSourceControlToken({
      userId: options.userId,
      sourceControlOrgId: org.id,
    });
  }

  return { org, token };
}
