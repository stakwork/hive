import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestSwarmOptions {
  name?: string;
  swarmId?: string;
  swarmUrl?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  swarmApiKey?: string;
  containerFilesSetUp?: boolean;
  poolName?: string;
  poolApiKey?: string;
}

export async function createTestSwarm(options: CreateTestSwarmOptions): Promise<Swarm> {
  const timestamp = Date.now();
  const name = options.name || `test-swarm-${timestamp}`;

  const baseData = {
    name,
    swarmUrl: options.swarmUrl || `https://${name}.test.sphinxlabs.ai/api`,
    workspaceId: options.workspaceId,
    status: options.status || "ACTIVE",
    instanceType: options.instanceType || "XL",
    agentRequestId: null,
    agentStatus: null,
    containerFilesSetUp: options.containerFilesSetUp ?? true, // Default to true for E2E tests
    poolName: options.poolName ?? null,
  };

  let createData = baseData as any;

  if (options.swarmApiKey) {
    createData.swarmApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", options.swarmApiKey));
  }

  if (options.poolApiKey) {
    createData.poolApiKey = JSON.stringify(encryptionService.encryptField("poolApiKey", options.poolApiKey));
  }

  return db.swarm.create({ data: createData });
}
