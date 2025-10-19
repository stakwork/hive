import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestSwarmOptions {
  name?: string;
  swarmId?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  swarmApiKey?: string;
  containerFilesSetUp?: boolean;
  poolName?: string | null;
  poolApiKey?: string | null;
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
  const timestamp = Date.now();

  const baseData = {
    name: options.name || `test-swarm-${timestamp}`,
    workspaceId: options.workspaceId,
    status: options.status || "ACTIVE",
    instanceType: options.instanceType || "XL",
    agentRequestId: null,
    agentStatus: null,
    containerFilesSetUp: options.containerFilesSetUp ?? true, // Default to true for E2E tests
    poolName: options.poolName !== undefined ? options.poolName : null,
  };

  let createData = options.swarmApiKey
    ? {
        ...baseData,
        swarmApiKey: JSON.stringify(
          encryptionService.encryptField("swarmApiKey", options.swarmApiKey)
        ),
      }
    : baseData;

  if (options.poolApiKey !== undefined) {
    createData = {
      ...createData,
      poolApiKey: options.poolApiKey,
    };
  }

  return db.swarm.create({ data: createData });
}
