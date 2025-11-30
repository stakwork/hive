import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  RepositoryStatus,
  SwarmStatus,
} from "@prisma/client";
import { slugify } from "./slugify";

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

  // Create encrypted mock pool API key for Pool Manager integration (optional)
  let encryptedPoolApiKey: string | null = null;
  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedPoolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "mock-pool-api-key")
    );
  } catch {
    // Encryption not available (e.g., TOKEN_ENCRYPTION_KEY not set)
    // This is fine for E2E tests - pool manager mock will work without encrypted key
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
        environmentVariables: [{ name: "NODE_ENV", value: "development" }],
        services: [
          { name: "stakgraph", port: 7799, scripts: { start: "start" } },
          { name: "repo2graph", port: 3355, scripts: { start: "start" } },
        ],
        workspaceId: workspace.id,
        swarmUrl: "http://localhost",
        agentRequestId: null,
        agentStatus: null,
        containerFilesSetUp: true, // Enable for E2E tests to show dashboard immediately
        poolApiKey: encryptedPoolApiKey, // Mock pool API key for Pool Manager mock
      },
    });

    return workspace;
  });

  return workspace.slug;
}
