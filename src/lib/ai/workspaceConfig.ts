import { forbiddenError, notFoundError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { listConcepts } from "@/lib/ai/askTools";
import { getSwarmVanityAddress } from "@/lib/constants";
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

  // Slugs are independent of one another, so fan them out. This runs before
  // every canvas turn — including prompt-cache hits, which skip the swarm
  // concept fetch but not this — so at the 20-slug cap the serial version was
  // ~100 round-trips deep on the critical path.
  const settled = await Promise.allSettled(
    slugs.map((slug) => buildOneWorkspaceConfig(slug, userId, encryptionService))
  );

  // Surface the first failure in *slug order* rather than whichever promise
  // happened to reject first, so the error a caller sees doesn't depend on
  // scheduling — that was the serial loop's behaviour and callers key off
  // these messages.
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      throw outcome.reason;
    }
  }

  return settled.map(
    (outcome) => (outcome as PromiseFulfilledResult<WorkspaceConfig>).value
  );
}

async function buildOneWorkspaceConfig(
  slug: string,
  userId: string,
  encryptionService: EncryptionService
): Promise<WorkspaceConfig> {
  // The access check stays first and alone: it yields `workspace.id` that the
  // rest depend on, and it is the authorization gate — nothing else should run
  // for a workspace the caller can't see.
  const access = await validateWorkspaceAccess(slug, userId, true);
  if (!access.hasAccess || !access.workspace) {
    throw forbiddenError(`Access denied for workspace: ${slug}`);
  }
  const workspaceId = access.workspace.id;

  const [swarm, repositories, githubProfile, memberships] = await Promise.all([
    db.swarm.findFirst({ where: { workspaceId } }),
    db.repository.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    }),
    getGithubUsernameAndPAT(userId, slug),
    // Fetch workspace members (name, github username, role, description).
    // `orderBy` is load-bearing: this roster is rendered near the top of
    // the cached system prompt, and `lastAccessedAt` writes churn these
    // rows — without a stable sort the heap order shifts and busts the
    // Anthropic prompt cache for the whole request.
    db.workspaceMember.findMany({
      where: { workspaceId, leftAt: null },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
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
    }),
  ]);

  // Validated in the same order the serial version used, so the error a
  // misconfigured workspace produces is unchanged.
  if (!swarm?.swarmUrl) {
    throw notFoundError(`Swarm not configured for workspace: ${slug}`);
  }
  if (repositories.length === 0) {
    throw notFoundError(`No repositories for workspace: ${slug}`);
  }
  if (!githubProfile?.token) {
    throw notFoundError(`GitHub PAT not found for workspace: ${slug}`);
  }

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = "http://localhost:3355";
  }

  return {
    slug,
    name: access.workspace.name,
    description: access.workspace.description ?? undefined,
    swarmUrl: baseSwarmUrl,
    swarmApiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || ""),
    swarmDomain: swarm.name ? getSwarmVanityAddress(swarm.name) : undefined,
    repoUrls: repositories.map((r) => r.repositoryUrl),
    pat: githubProfile.token,
    currentUserGithubUsername: githubProfile.username ?? undefined,
    workspaceId,
    userId,
    members: memberships.map((m) => ({
      name: m.user.name,
      githubUsername: m.user.githubAuth?.githubUsername ?? null,
      role: m.role,
      description: m.description,
    })),
  };
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
  //
  // Stable `orderBy` for the same reason as `buildWorkspaceConfigs`:
  // an unordered roster reshuffles under row churn and busts the
  // cached system prompt.
  const memberships = await db.workspaceMember.findMany({
    where: { workspaceId: workspace.id, leftAt: null },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
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
    swarmDomain: swarm.name ? getSwarmVanityAddress(swarm.name) : undefined,
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
        conceptsByWorkspace[ws.slug] = (concepts.concepts as Record<string, unknown>[]) || [];
      } catch (e) {
        console.error(`Failed to fetch concepts for ${ws.slug}:`, e);
        conceptsByWorkspace[ws.slug] = [];
      }
    })
  );

  return conceptsByWorkspace;
}
