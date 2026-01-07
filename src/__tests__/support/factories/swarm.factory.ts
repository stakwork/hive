import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import {
  SWARM_VALUES,
  getRandomSwarm,
  type SwarmValueKey,
} from "../values/swarms";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestSwarmOptions {
  /** Use named value from SWARM_VALUES (e.g., "default", "e2eReady") */
  valueKey?: SwarmValueKey;
  name?: string;
  swarmId?: string;
  swarmUrl?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
  swarmApiKey?: string;
  containerFilesSetUp?: boolean;
  containerFiles?: any; // JSON array of container config files
  poolName?: string;
  poolApiKey?: string;
  poolState?: "NOT_STARTED" | "STARTED" | "FAILED" | "COMPLETE";
  /** If true, return existing swarm if name+workspace match */
  idempotent?: boolean;
}

export async function createTestSwarm(
  options: CreateTestSwarmOptions,
): Promise<Swarm> {
  // Get base values from valueKey or generate defaults
  const baseValues = options.valueKey
    ? SWARM_VALUES[options.valueKey]
    : null;

  const timestamp = Date.now();
  const name = options.name ?? baseValues?.name ?? `test-swarm-${timestamp}`;

  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.swarm.findFirst({
      where: { workspaceId: options.workspaceId, name },
    });
    if (existing) return existing;
  }

  const baseData = {
    name,
    swarmUrl: options.swarmUrl ?? baseValues?.swarmUrl ?? `https://${name}.test.sphinxlabs.ai/api`,
    workspaceId: options.workspaceId,
    status: options.status ?? baseValues?.status ?? "ACTIVE",
    instanceType: options.instanceType ?? baseValues?.instanceType ?? "XL",
    agentRequestId: null,
    agentStatus: null,
    containerFilesSetUp: options.containerFilesSetUp ?? baseValues?.containerFilesSetUp ?? true,
    containerFiles: options.containerFiles ?? null,
    poolName: options.poolName ?? null,
    poolState: options.poolState ?? baseValues?.poolState ?? "NOT_STARTED",
  };

   
  const createData = baseData as any;

  // Encrypt API keys if provided
  const swarmApiKey = options.swarmApiKey ?? (options.valueKey ? "test-swarm-api-key" : undefined);
  if (swarmApiKey && process.env.TOKEN_ENCRYPTION_KEY) {
    createData.swarmApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", swarmApiKey)
    );
  }

  if (options.poolApiKey && process.env.TOKEN_ENCRYPTION_KEY) {
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
