import { forbiddenError, notFoundError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { listConcepts } from "@/lib/ai/askTools";
import { WorkspaceConfig } from "./types";

export type { WorkspaceConfig };

/**
 * Synthetic userId we stamp onto WorkspaceConfig for public-viewer
 * (anonymous) traffic. Tools that key cache/log entries on userId
 * (e.g. mcpTools.findWorkspaceUser) get a stable string instead of
 * `null`, while remaining identifiable as anonymous.
 */
export const PUBLIC_VIEWER_USER_ID = "__public_viewer__";

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
      name: access.workspace.name,
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
 * Build a WorkspaceConfig for an unauthenticated public viewer of a
 * `Workspace.isPublicViewable` workspace. Mirrors `buildWorkspaceConfigs`
 * but skips the per-user PAT lookup (anonymous visitors have no PAT)
 * and falls back to the workspace owner's PAT.
 *
 * Caller is responsible for ensuring the workspace is actually
 * public-viewable (use `resolveWorkspaceAccess` and check
 * `kind === "public-viewer"` BEFORE calling this) — this function
 * does not re-verify, it just hydrates a config from the slug.
 */
export async function buildPublicWorkspaceConfig(
  slug: string,
): Promise<WorkspaceConfig> {
  const encryptionService = EncryptionService.getInstance();

  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false, isPublicViewable: true },
    select: {
      id: true,
      name: true,
      slug: true,
      ownerId: true,
      description: true,
    },
  });
  if (!workspace) {
    throw forbiddenError(`Workspace not public or not found: ${slug}`);
  }

  const swarm = await db.swarm.findFirst({
    where: { workspaceId: workspace.id },
  });
  if (!swarm?.swarmUrl) {
    throw notFoundError(`Swarm not configured for workspace: ${slug}`);
  }

  const repositories = await db.repository.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
  });
  if (repositories.length === 0) {
    throw notFoundError(`No repositories for workspace: ${slug}`);
  }

  // Fall back to the workspace owner's PAT for any tool that needs to
  // hit GitHub on the visitor's behalf (recent_commits, contributor PRs,
  // repo_agent). Public viewers chose not to authenticate; we trade
  // their identity for the owner's credentials, scoped to the public
  // workspace's repos. If the owner has no PAT either, we proceed
  // without one — `askTools` tolerates an empty pat (those tools just
  // won't be useful), and the dominant tools (concepts, search,
  // gitree) only need the swarm key.
  const ownerProfile = await getGithubUsernameAndPAT(workspace.ownerId, slug);
  const pat = ownerProfile?.token ?? "";

  // Members list is used in the prompt so the agent can refer to
  // contributors by name. Public viewers see it too — names are
  // public knowledge for an isPublicViewable workspace.
  const memberships = await db.workspaceMember.findMany({
    where: { workspaceId: workspace.id, leftAt: null },
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

  return {
    slug,
    name: workspace.name,
    description: workspace.description ?? undefined,
    swarmUrl: baseSwarmUrl,
    swarmApiKey: encryptionService.decryptField(
      "swarmApiKey",
      swarm.swarmApiKey || "",
    ),
    repoUrls: repositories.map((r) => r.repositoryUrl),
    pat,
    workspaceId: workspace.id,
    userId: PUBLIC_VIEWER_USER_ID,
    members: memberships.map((m) => ({
      name: m.user.name,
      githubUsername: m.user.githubAuth?.githubUsername ?? null,
      role: m.role,
      description: m.description,
    })),
  };
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
