import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
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
  swarmPassword?: string;
  containerFilesSetUp?: boolean;
  containerFiles?: any; // JSON array of container config files
  poolName?: string;
  poolApiKey?: string;
  poolState?: "NOT_STARTED" | "STARTED" | "FAILED" | "COMPLETE";
  podState?: "NOT_STARTED" | "VALIDATING" | "COMPLETED" | "FAILED";
  ec2Id?: string;
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
    const existing = await db.swarms.findFirst({
      where: {workspace_id: options.workspaceId, name },
    });
    if (existing) return existing;
  }

  const baseData = {
    id: generateUniqueId("swarm"),
    name,
    swarm_url: options.swarmUrl ?? baseValues?.swarmUrl ?? `https://${name}.test.sphinxlabs.ai/api`,
    workspace_id: options.workspaceId,
    status: options.status ?? baseValues?.status ?? "ACTIVE",
    instance_type: options.instanceType ?? baseValues?.instanceType ?? "XL",
    agent_request_id: null,
    agent_status: null,
    container_files_set_up: options.containerFilesSetUp ?? baseValues?.containerFilesSetUp ?? true,
    container_files: options.containerFiles ?? null,
    pool_name: options.poolName ?? null,
    pool_state: options.poolState ?? baseValues?.poolState ?? "NOT_STARTED",
    pod_state: options.podState ?? "NOT_STARTED",
    ec2_id: options.ec2Id ?? null,
    updated_at: new Date(),
  };

   
  const createData = baseData as any;

  // Encrypt API keys if provided
  const swarmApiKey = options.swarmApiKey ?? (options.valueKey ? "test-swarm-api-key" : undefined);
  if (swarmApiKey && process.env.TOKEN_ENCRYPTION_KEY) {
    createData.swarm_api_key = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", swarmApiKey)
    );
  }

  if (options.poolApiKey && process.env.TOKEN_ENCRYPTION_KEY) {
    createData.pool_api_key = JSON.stringify(
      encryptionService.encryptField("poolApiKey", options.poolApiKey)
    );
  }

  // Encrypt swarm password if provided
  if (options.swarmPassword && process.env.TOKEN_ENCRYPTION_KEY) {
    createData.swarm_password = JSON.stringify(
      encryptionService.encryptField("swarmPassword", options.swarmPassword)
    );
  }

  return db.swarms.create({ data: createData });
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
