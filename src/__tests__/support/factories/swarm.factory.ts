/**
 * Swarm Factory - Creates swarm entities with data from values layer
 */
import { db } from "@/lib/db";
import type { Swarm } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import {
  SWARM_VALUES,
  SWARM_POOLS,
  getRandomSwarm,
  type SwarmValueKey,
} from "../values/swarms";

const encryptionService = EncryptionService.getInstance();

export interface CreateSwarmOptions {
  // Use named value from SWARM_VALUES
  valueKey?: SwarmValueKey;
  // Required context
  workspaceId: string;
  // Custom overrides
  name?: string;
  swarmUrl?: string;
  status?: typeof SWARM_POOLS.statuses[number];
  instanceType?: string;
  containerFilesSetUp?: boolean;
  poolState?: typeof SWARM_POOLS.poolStates[number];
  // API keys (will be encrypted)
  swarmApiKey?: string;
  poolName?: string;
  poolApiKey?: string;
  // Control behavior
  idempotent?: boolean;
}

/**
 * Create a single swarm with encrypted API keys
 *
 * @example
 * // Use named value (ready for E2E)
 * const swarm = await createSwarm({
 *   valueKey: "e2eReady",
 *   workspaceId: workspace.id
 * });
 *
 * @example
 * // Use default active swarm
 * const swarm = await createSwarm({
 *   valueKey: "default",
 *   workspaceId: workspace.id,
 *   swarmApiKey: "my-api-key"
 * });
 *
 * @example
 * // Use random values
 * const swarm = await createSwarm({ workspaceId: workspace.id });
 */
export async function createSwarm(options: CreateSwarmOptions): Promise<Swarm> {
  // Get base values from valueKey or random pool
  const baseValues = options.valueKey
    ? SWARM_VALUES[options.valueKey]
    : getRandomSwarm();

  const name = options.name ?? baseValues.name;

  // Idempotent: check if exists by name
  if (options.idempotent) {
    const existing = await db.swarm.findFirst({
      where: { workspaceId: options.workspaceId, name },
    });
    if (existing) return existing;
  }

  const baseData = {
    name,
    swarmUrl: options.swarmUrl ?? baseValues.swarmUrl ?? `https://${name}.sphinx.chat`,
    workspaceId: options.workspaceId,
    status: options.status ?? baseValues.status ?? "ACTIVE",
    instanceType: options.instanceType ?? baseValues.instanceType ?? "XL",
    agentRequestId: null,
    agentStatus: null,
    containerFilesSetUp: options.containerFilesSetUp ?? baseValues.containerFilesSetUp ?? true,
    poolName: options.poolName ?? null,
    poolState: options.poolState ?? baseValues.poolState ?? "COMPLETE",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createData = baseData as any;

  // Encrypt API keys if provided and encryption is available
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
 * Create a ready-to-use swarm for E2E testing
 * Convenience wrapper with common defaults for testing
 *
 * @example
 * const swarm = await createE2EReadySwarm(workspace.id);
 */
export async function createE2EReadySwarm(
  workspaceId: string,
  options: Partial<Omit<CreateSwarmOptions, "workspaceId" | "valueKey">> = {}
): Promise<Swarm> {
  return createSwarm({
    valueKey: "e2eReady",
    workspaceId,
    swarmApiKey: options.swarmApiKey ?? "test-e2e-api-key",
    ...options,
  });
}

/**
 * Create multiple swarms with varied data
 *
 * @example
 * const swarms = await createSwarms(workspace.id, 3);
 */
export async function createSwarms(workspaceId: string, count: number): Promise<Swarm[]> {
  const swarms: Swarm[] = [];

  for (let i = 0; i < count; i++) {
    const swarm = await createSwarm({ workspaceId });
    swarms.push(swarm);
  }

  return swarms;
}

/**
 * Get or create a swarm by name (always idempotent)
 */
export async function getOrCreateSwarm(
  workspaceId: string,
  name: string,
  options: Omit<CreateSwarmOptions, "workspaceId" | "name" | "idempotent"> = {}
): Promise<Swarm> {
  return createSwarm({ ...options, workspaceId, name, idempotent: true });
}
