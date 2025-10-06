import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface CreateTestSwarmOptions {
  workspaceId: string;
  swarmUrl?: string;
  swarmApiKey?: string;
  repositoryUrl?: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  name?: string;
}

/**
 * Creates a test swarm for integration tests
 */
export async function createTestSwarm(
  options: CreateTestSwarmOptions
): Promise<Prisma.SwarmGetPayload<{}>> {
  const {
    workspaceId,
    swarmUrl = "https://swarm.example.com",
    swarmApiKey = JSON.stringify({
      data: "encrypted-test-key",
      iv: "test-iv",
      tag: "test-tag",
      version: "v1",
      encryptedAt: new Date().toISOString(),
    }),
    repositoryUrl = "https://github.com/test-org/test-repo",
    status = "ACTIVE",
    name = "Test Swarm",
  } = options;

  return db.swarm.create({
    data: {
      workspaceId,
      swarmUrl,
      swarmApiKey,
      repositoryUrl,
      status,
      name,
    },
  });
}