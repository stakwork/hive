import { db } from "@/lib/db";
import type { Swarm, Prisma } from "@prisma/client";

export interface CreateTestSwarmOptions {
  name?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  repositoryUrl?: string | null;
  swarmApiKey?: string | null;
  tx?: Prisma.TransactionClient;
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
  const timestamp = Date.now();
  const client = options.tx || db;

  return client.swarm.create({
    data: {
      name: options.name || `test-swarm-${timestamp}`,
      workspaceId: options.workspaceId,
      status: options.status || "ACTIVE",
      instanceType: options.instanceType || "XL",
      repositoryUrl: options.repositoryUrl ?? null,
      swarmApiKey: options.swarmApiKey ?? undefined,
    },
  });
}
