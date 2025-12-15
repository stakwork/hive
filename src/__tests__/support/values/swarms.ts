/**
 * Swarm data pools - edit THIS file when Swarm schema changes
 *
 * Structure:
 * - Named entries: Specific swarm configurations for deterministic scenarios
 * - Pools: Arrays for generating varied data
 */

export const SWARM_VALUES = {
  // Named entries for specific scenarios
  default: {
    name: "acme-swarm",
    swarmUrl: "https://acme-swarm.sphinx.chat",
    status: "ACTIVE" as const,
    instanceType: "XL",
    containerFilesSetUp: true,
    poolState: "COMPLETE" as const,
  },
  pending: {
    name: "pending-swarm",
    swarmUrl: "https://pending-swarm.sphinx.chat",
    status: "PENDING" as const,
    instanceType: "M",
    containerFilesSetUp: false,
    poolState: "NOT_STARTED" as const,
  },
  configuring: {
    name: "configuring-swarm",
    swarmUrl: "https://configuring-swarm.sphinx.chat",
    status: "ACTIVE" as const,
    instanceType: "L",
    containerFilesSetUp: false,
    poolState: "STARTED" as const,
  },
  failed: {
    name: "failed-swarm",
    swarmUrl: "https://failed-swarm.sphinx.chat",
    status: "FAILED" as const,
    instanceType: "M",
    containerFilesSetUp: false,
    poolState: "FAILED" as const,
  },
  e2eReady: {
    name: "e2e-ready-swarm",
    swarmUrl: "https://e2e-ready.sphinx.chat",
    status: "ACTIVE" as const,
    instanceType: "XL",
    containerFilesSetUp: true,
    poolState: "COMPLETE" as const,
  },
} as const;

// Pools for generating varied data
export const SWARM_POOLS = {
  namePrefixes: [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "prod",
    "staging",
    "dev",
    "test",
    "demo",
  ],
  statuses: ["PENDING", "ACTIVE", "FAILED", "DELETED"] as const,
  instanceTypes: ["S", "M", "L", "XL", "XXL"] as const,
  poolStates: ["NOT_STARTED", "STARTED", "FAILED", "COMPLETE"] as const,
  domains: [
    "sphinx.chat",
    "sphinxlabs.ai",
    "swarm.dev",
  ],
} as const;

// Counter for unique generation
let swarmCounter = 0;

/**
 * Get a random swarm configuration from the pools with unique name
 */
export function getRandomSwarm() {
  const prefix = SWARM_POOLS.namePrefixes[Math.floor(Math.random() * SWARM_POOLS.namePrefixes.length)];
  const domain = SWARM_POOLS.domains[Math.floor(Math.random() * SWARM_POOLS.domains.length)];
  const uniqueSuffix = ++swarmCounter;
  const name = `${prefix}-swarm-${uniqueSuffix}`;
  const swarmUrl = `https://${name}.${domain}`;

  // Bias toward active, complete swarms for testing
  const status = Math.random() > 0.2 ? "ACTIVE" : SWARM_POOLS.statuses[Math.floor(Math.random() * SWARM_POOLS.statuses.length)];
  const instanceType = SWARM_POOLS.instanceTypes[Math.floor(Math.random() * SWARM_POOLS.instanceTypes.length)];
  const poolState = status === "ACTIVE" ? "COMPLETE" : SWARM_POOLS.poolStates[Math.floor(Math.random() * SWARM_POOLS.poolStates.length)];

  return {
    name,
    swarmUrl,
    status: status as typeof SWARM_POOLS.statuses[number],
    instanceType,
    containerFilesSetUp: status === "ACTIVE" && poolState === "COMPLETE",
    poolState: poolState as typeof SWARM_POOLS.poolStates[number],
  };
}

/**
 * Get a named swarm value by key
 */
export function getNamedSwarm(key: keyof typeof SWARM_VALUES) {
  return { ...SWARM_VALUES[key] };
}

/**
 * Reset swarm counter (useful for test isolation)
 */
export function resetSwarmCounter() {
  swarmCounter = 0;
}

export type SwarmValueKey = keyof typeof SWARM_VALUES;
export type SwarmValue = typeof SWARM_VALUES[SwarmValueKey];
