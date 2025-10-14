import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestSwarmOptions {
  name?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  swarmApiKey?: string;
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
  const timestamp = Date.now();

  const data: any = {
    name: options.name || `test-swarm-${timestamp}`,
    workspaceId: options.workspaceId,
    status: options.status || "ACTIVE",
    instanceType: options.instanceType || "XL",
  };

  if (options.swarmApiKey) {
    data.swarmApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", options.swarmApiKey)
    );
  }

  return db.swarm.create({ data });
}
