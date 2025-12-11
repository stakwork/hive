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
  poolState?: "NOT_STARTED" | "STARTED" | "FAILED" | "COMPLETE";
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
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
    poolState: options.poolState ?? "NOT_STARTED",
  };

  let createData = baseData as any;

  if (options.swarmApiKey) {
    createData.swarmApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", options.swarmApiKey)
    );
  }

  if (options.poolApiKey) {
    createData.poolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", options.poolApiKey)
    );
  }

  return db.swarm.create({ data: createData });
}

/**
 * Creates a test swarm with encrypted API key for learnings API tests
 * This is a convenience wrapper around createTestSwarm with common defaults
 * 
 * @param workspaceId - The workspace ID to associate the swarm with
 * @param options - Optional overrides for swarm configuration
 * @returns The created swarm with encrypted API key
 */
export async function createTestSwarmWithEncryptedApiKey(
  workspaceId: string,
  options?: {
    name?: string;
    swarmUrl?: string;
    apiKey?: string;
    status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  }
): Promise<Swarm> {
  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(7);
  
  return createTestSwarm({
    workspaceId,
    name: options?.name || `test-swarm-${timestamp}-${uniqueId}`,
    swarmUrl: options?.swarmUrl || "https://test-swarm.sphinx.chat",
    swarmApiKey: options?.apiKey || "test-swarm-api-key",
    status: options?.status || "ACTIVE",
  });
}
