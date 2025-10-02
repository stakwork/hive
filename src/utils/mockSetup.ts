import { db } from "@/lib/db";
import {
  RepositoryStatus,
  SwarmStatus,
} from "@prisma/client";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Ensures a mock workspace and a completed swarm exist for a given user.
 * Returns the workspace slug.
 * All DB operations wrapped in transaction for atomicity.
 */
export async function ensureMockWorkspaceForUser(
  userId: string,
): Promise<string> {
  const existing = await db.workspace.findFirst({
    where: { ownerId: userId, deleted: false },
    select: { id: true, slug: true },
  });

  if (existing?.slug) return existing.slug;

  const baseSlug = "mock-stakgraph";
  let slugCandidate = baseSlug;
  let suffix = 1;
  while (await db.workspace.findUnique({ where: { slug: slugCandidate } })) {
    slugCandidate = `${baseSlug}-${++suffix}`;
  }

  // Wrap all DB operations in transaction to prevent partial state
  const workspace = await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: "Mock Workspace",
        description: "Development workspace (mock)",
        slug: slugCandidate,
        ownerId: userId,
      },
      select: { id: true, slug: true },
    });

    // Optional repository seed to satisfy UIs expecting a repository
    await tx.repository.create({
      data: {
        name: "stakgraph",
        repositoryUrl: "https://github.com/mock/stakgraph",
        branch: "main",
        status: RepositoryStatus.SYNCED,
        workspaceId: workspace.id,
      },
    });

    await tx.swarm.create({
      data: {
        name: slugify(`${workspace.slug}-swarm`),
        status: SwarmStatus.ACTIVE,
        instanceType: "XL",
        repositoryName: "stakgraph",
        repositoryUrl: "https://github.com/mock/stakgraph",
        defaultBranch: "main",
        environmentVariables: [{ name: "NODE_ENV", value: "development" }],
        services: [
          { name: "stakgraph", port: 7799, scripts: { start: "start" } },
          { name: "repo2graph", port: 3355, scripts: { start: "start" } },
        ],
        workspaceId: workspace.id,
        swarmUrl: "http://localhost",
      },
    });

    return workspace;
  });

  return workspace.slug;
}
