import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";

export interface CreateTestSwarmOptions {
  name?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  repositoryUrl?: string | null;
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
  const timestamp = Date.now();

  return db.swarm.create({
    data: {
      name: options.name || `test-swarm-${timestamp}`,
      workspaceId: options.workspaceId,
      status: options.status || "ACTIVE",
      instanceType: options.instanceType || "XL",
      repositoryUrl: options.repositoryUrl ?? null,
    },
  });
}
