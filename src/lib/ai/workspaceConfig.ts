import { forbiddenError, notFoundError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { listConcepts } from "@/lib/ai/askTools";
import { WorkspaceConfig } from "./types";

/**
 * Build WorkspaceConfig[] by validating access, fetching swarm credentials,
 * repositories, and GitHub PAT for each workspace.
 * Works for both single and multi-workspace — always takes an array of slugs.
 */
export async function buildWorkspaceConfigs(
  slugs: string[],
  userId: string
): Promise<WorkspaceConfig[]> {
  const encryptionService = EncryptionService.getInstance();
  const configs: WorkspaceConfig[] = [];

  for (const slug of slugs) {
    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess || !access.workspace) {
      throw forbiddenError(`Access denied for workspace: ${slug}`);
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: access.workspace.id },
    });
    if (!swarm?.swarmUrl) {
      throw notFoundError(`Swarm not configured for workspace: ${slug}`);
    }

    const repositories = await db.repository.findMany({
      where: { workspaceId: access.workspace.id },
      orderBy: { createdAt: "asc" },
    });
    if (repositories.length === 0) {
      throw notFoundError(`No repositories for workspace: ${slug}`);
    }

    const githubProfile = await getGithubUsernameAndPAT(userId, slug);
    if (!githubProfile?.token) {
      throw notFoundError(`GitHub PAT not found for workspace: ${slug}`);
    }

    // Fetch workspace members (name, github username, role, description)
    const memberships = await db.workspaceMember.findMany({
      where: { workspaceId: access.workspace.id, leftAt: null },
      select: {
        role: true,
        description: true,
        user: {
          select: {
            name: true,
            githubAuth: { select: { githubUsername: true } },
          },
        },
      },
    });

    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = "http://localhost:3355";
    }

    configs.push({
      slug,
      description: access.workspace.description ?? undefined,
      swarmUrl: baseSwarmUrl,
      swarmApiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || ""),
      repoUrls: repositories.map((r) => r.repositoryUrl),
      pat: githubProfile.token,
      workspaceId: access.workspace.id,
      userId,
      members: memberships.map((m) => ({
        name: m.user.name,
        githubUsername: m.user.githubAuth?.githubUsername ?? null,
        role: m.role,
        description: m.description,
      })),
    });
  }

  return configs;
}

/**
 * Fetch concepts for all workspaces in parallel.
 */
export async function fetchConceptsForWorkspaces(
  configs: WorkspaceConfig[]
): Promise<Record<string, Record<string, unknown>[]>> {
  const conceptsByWorkspace: Record<string, Record<string, unknown>[]> = {};

  await Promise.all(
    configs.map(async (ws) => {
      try {
        const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
        conceptsByWorkspace[ws.slug] = (concepts.features as Record<string, unknown>[]) || [];
      } catch (e) {
        console.error(`Failed to fetch concepts for ${ws.slug}:`, e);
        conceptsByWorkspace[ws.slug] = [];
      }
    })
  );

  return conceptsByWorkspace;
}
