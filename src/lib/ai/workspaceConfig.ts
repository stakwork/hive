import { forbiddenError, notFoundError } from "@/types/errors";
import { getGithubUsernameAndPAT, resolveGithubIdentity, type GithubIdentity } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { listConcepts } from "@/lib/ai/askTools";
import { MAX_SEEDED_CONCEPTS_PER_WORKSPACE } from "@/lib/ai/concepts";
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

  // Per-slug work runs concurrently: every step below is a read, and the
  // slugs are independent. Serially this cost ~10 DB round-trips per
  // workspace *times* the slug count, which on a canvas turn spanning 8
  // org workspaces dominated the whole request (~35s of a 42s turn).
  //
  // The user's GitHub identity is resolved once here rather than inside
  // each slug's `getGithubUsernameAndPAT` — it does not vary by
  // workspace, and re-reading it per slug was 2 more round-trips each.
  // It overlaps with the access checks, so it costs nothing on the wire.
  //
  // `allSettled` rather than `Promise.all` so the error we surface is
  // deterministic: `Promise.all` rejects with whichever slug failed
  // *first in time*, while the serial loop always reported the first
  // failure in *slug order*. We reproduce the latter below.
  const [identity, accessSettled] = await Promise.all([
    resolveGithubIdentity(userId),
    Promise.allSettled(
      slugs.map((slug) => validateWorkspaceAccess(slug, userId, true))
    ),
  ]);

  // Phase 2: for every slug that cleared its access check, fan out the
  // four remaining reads — they only need `workspace.id`, so nothing
  // among them depends on anything else.
  const recordsSettled = await Promise.allSettled(
    slugs.map((slug, i) => {
      const access = accessSettled[i];
      if (access.status === "rejected" || !access.value.hasAccess || !access.value.workspace) {
        return Promise.resolve(null);
      }
      return fetchWorkspaceRecords(slug, userId, access.value.workspace.id, identity);
    })
  );

  // Guards run per slug in the original nested order (access → swarm →
  // repos → PAT), so the error that surfaces is the same one the serial
  // loop produced: an earlier slug's *later* failure still wins over a
  // later slug's *earlier* failure. `map` also preserves slug order,
  // which is load-bearing — callers treat `configs[0]` as the primary
  // workspace, and the rendered system prompt (Anthropic prompt-cached)
  // must be byte-stable across turns.
  return slugs.map((slug, i) => {
    const access = accessSettled[i];
    if (access.status === "rejected") throw access.reason;
    if (!access.value.hasAccess || !access.value.workspace) {
      throw forbiddenError(`Access denied for workspace: ${slug}`);
    }

    const records = recordsSettled[i];
    if (records.status === "rejected") throw records.reason;

    return assembleWorkspaceConfig(
      slug,
      userId,
      access.value.workspace,
      records.value!,
      encryptionService
    );
  });
}

type WorkspaceRecords = Awaited<ReturnType<typeof fetchWorkspaceRecords>>;

async function fetchWorkspaceRecords(
  slug: string,
  userId: string,
  workspaceId: string,
  identity: GithubIdentity | null
) {
  // These re-read rows that `validateWorkspaceAccess` already loaded:
  // `getWorkspaceBySlug` includes `swarm` and `repositories`, then maps
  // them away into the narrow `WorkspaceResponse` it returns. Sourcing
  // them from there instead would cut ~2 queries per workspace, but it
  // buys no wall-clock (the PAT branch below is the deeper one) and the
  // fields we need — `swarmApiKey`, `swarm.name` — must NOT be added to
  // that function's return: `WorkspaceWithAccess` is serialized straight
  // to the browser by /api/workspaces/[slug], including for anonymous
  // viewers of public workspaces. Any such reuse has to go through a
  // separate server-only accessor, not a widened DTO.
  const [swarm, repositories, githubProfile, memberships] = await Promise.all([
    db.swarm.findFirst({ where: { workspaceId } }),
    db.repository.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    }),
    // A null identity means the user has no GitHub username at all, so
    // the per-workspace token lookup cannot succeed — skip the query and
    // let the PAT guard below report it.
    identity ? getGithubUsernameAndPAT(userId, slug, identity) : Promise.resolve(null),
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

  return { swarm, repositories, githubProfile, memberships };
}

function assembleWorkspaceConfig(
  slug: string,
  userId: string,
  workspace: { id: string; name: string; description?: string | null },
  records: WorkspaceRecords,
  encryptionService: EncryptionService
): WorkspaceConfig {
  const { swarm, repositories, githubProfile, memberships } = records;

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
    name: workspace.name,
    description: workspace.description ?? undefined,
    swarmUrl: baseSwarmUrl,
    swarmApiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || ""),
    swarmDomain: swarm.name ? getSwarmVanityAddress(swarm.name) : undefined,
    repoUrls: repositories.map((r) => r.repositoryUrl),
    pat: githubProfile.token,
    currentUserGithubUsername: githubProfile.username ?? undefined,
    workspaceId: workspace.id,
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
        conceptsByWorkspace[ws.slug] = ((concepts.concepts as Record<string, unknown>[]) || []).slice(0, MAX_SEEDED_CONCEPTS_PER_WORKSPACE);
      } catch (e) {
        console.error(`Failed to fetch concepts for ${ws.slug}:`, e);
        conceptsByWorkspace[ws.slug] = [];
      }
    })
  );

  return conceptsByWorkspace;
}
