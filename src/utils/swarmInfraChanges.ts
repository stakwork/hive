/**
 * Detects whether incoming stakgraph settings contain infrastructure-affecting changes
 * that require pod regeneration via syncPoolManagerSettings.
 *
 * Infrastructure-triggering fields:
 * - services (array/object)
 * - containerFiles["pm2.config.js"] (base64 string)
 * - containerFiles["Dockerfile"] (string)
 * - containerFiles["docker-compose.yml"] (string)
 * - containerFiles["devcontainer.json"] (string)
 * - environmentVariables (array of name+value pairs)
 * - poolCpu (string)
 * - poolMemory (string)
 * - Repository list (count or URL set)
 *
 * Metadata-only fields (do NOT trigger sync):
 * - description, name, swarmUrl, swarmSecretAlias, slug
 *
 * @returns true if any infrastructure field changed; false if only metadata changed or nothing changed
 */
export function hasInfrastructureChange(
  incoming: {
    services?: unknown;
    containerFiles?: Record<string, string>;
    environmentVariables?: Array<{ name: string; value: string }>;
    poolCpu?: string;
    poolMemory?: string;
    repositories?: Array<{ repositoryUrl: string }>;
  },
  existing: {
    services?: unknown;
    containerFiles?: unknown;
    environmentVariables?: unknown;
    poolCpu?: string | null;
    poolMemory?: string | null;
  } | null,
  incomingRepos: Array<{ repositoryUrl: string }>,
  existingRepos: Array<{ repositoryUrl: string }>,
): boolean {
  // First save (no existing swarm) always triggers sync
  if (!existing) {
    return true;
  }

  // Compare services (JSON-serialized)
  if (incoming.services !== undefined) {
    const incomingServices = normalizeToJson(incoming.services);
    const existingServices = normalizeToJson(existing.services);
    if (incomingServices !== existingServices) {
      return true;
    }
  }

  // Compare containerFiles["pm2.config.js"]
  // Skip when services are also provided — pm2 is derived from services,
  // so the services comparison above is the source of truth. Comparing both
  // can produce false positives due to client vs server generation differences
  // (e.g., env var ordering in the pm2 config).
  if (
    incoming.services === undefined &&
    incoming.containerFiles?.["pm2.config.js"] !== undefined
  ) {
    const incomingPm2 = incoming.containerFiles["pm2.config.js"];
    const existingPm2 = extractPm2Config(existing.containerFiles);
    if (incomingPm2 !== existingPm2) {
      return true;
    }
  }

  // Compare Dockerfile
  if (incoming.containerFiles?.["Dockerfile"] !== undefined) {
    const incomingDockerfile = incoming.containerFiles["Dockerfile"];
    const existingDockerfile = extractContainerFile(existing.containerFiles, "Dockerfile");
    if (incomingDockerfile !== existingDockerfile) {
      return true;
    }
  }

  // Compare docker-compose.yml
  if (incoming.containerFiles?.["docker-compose.yml"] !== undefined) {
    const incomingCompose = incoming.containerFiles["docker-compose.yml"];
    const existingCompose = extractContainerFile(existing.containerFiles, "docker-compose.yml");
    if (incomingCompose !== existingCompose) {
      return true;
    }
  }

  // Compare devcontainer.json
  if (incoming.containerFiles?.["devcontainer.json"] !== undefined) {
    const incomingDevcontainer = incoming.containerFiles["devcontainer.json"];
    const existingDevcontainer = extractContainerFile(existing.containerFiles, "devcontainer.json");
    if (incomingDevcontainer !== existingDevcontainer) {
      return true;
    }
  }

  // Compare environmentVariables (name+value set)
  if (incoming.environmentVariables !== undefined) {
    const incomingEnvVars = normalizeEnvVars(incoming.environmentVariables);
    const existingEnvVars = normalizeEnvVars(existing.environmentVariables);
    if (!areEnvVarsEqual(incomingEnvVars, existingEnvVars)) {
      return true;
    }
  }

  // Compare poolCpu
  if (incoming.poolCpu !== undefined) {
    const existingCpu = existing.poolCpu ?? undefined;
    if (incoming.poolCpu !== existingCpu) {
      return true;
    }
  }

  // Compare poolMemory
  if (incoming.poolMemory !== undefined) {
    const existingMemory = existing.poolMemory ?? undefined;
    if (incoming.poolMemory !== existingMemory) {
      return true;
    }
  }

  // Compare repository list (count + URL set)
  if (!areReposEqual(incomingRepos, existingRepos)) {
    return true;
  }

  // No infrastructure changes detected
  return false;
}

/**
 * Recursively sort object keys for stable JSON stringification.
 * Ensures {a:1, b:2} and {b:2, a:1} produce the same string.
 */
function stableSortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stableSortKeys);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = stableSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalize unknown value to a stable JSON string for comparison.
 * Handles JSON strings, arrays, objects, and null/undefined.
 * Object keys are sorted recursively so property order doesn't matter.
 */
function normalizeToJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  // If it's already a string, try parsing it as JSON
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(stableSortKeys(parsed));
    } catch {
      // Not valid JSON, return as-is
      return value;
    }
  }

  // Serialize objects/arrays with stable key ordering
  return JSON.stringify(stableSortKeys(value));
}

/**
 * Extract a named file from containerFiles (handles Record<string, string> or unknown types)
 */
function extractContainerFile(containerFiles: unknown, key: string): string | undefined {
  if (!containerFiles || typeof containerFiles !== "object") {
    return undefined;
  }

  const files = containerFiles as Record<string, unknown>;
  const value = files[key];

  return typeof value === "string" ? value : undefined;
}

/**
 * Extract pm2.config.js from containerFiles (handles Record<string, string> or unknown types)
 */
function extractPm2Config(containerFiles: unknown): string | undefined {
  return extractContainerFile(containerFiles, "pm2.config.js");
}

/**
 * Normalize environmentVariables to a consistent array format.
 * Handles JSON strings, arrays, and null/undefined.
 */
function normalizeEnvVars(
  envVars: unknown,
): Array<{ name: string; value: string }> {
  if (!envVars) {
    return [];
  }

  // If it's a JSON string, parse it
  if (typeof envVars === "string") {
    try {
      const parsed = JSON.parse(envVars);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Invalid JSON, treat as empty
      return [];
    }
  }

  // If it's already an array, return it
  if (Array.isArray(envVars)) {
    return envVars;
  }

  return [];
}

/**
 * Compare two environment variable arrays for equality (order-independent).
 */
function areEnvVarsEqual(
  a: Array<{ name: string; value: string }>,
  b: Array<{ name: string; value: string }>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  // Sort both arrays by name for comparison
  const sortedA = [...a].sort((x, y) => x.name.localeCompare(y.name));
  const sortedB = [...b].sort((x, y) => x.name.localeCompare(y.name));

  return sortedA.every(
    (envVar, index) =>
      envVar.name === sortedB[index].name &&
      envVar.value === sortedB[index].value,
  );
}

/**
 * Compare two repository arrays for equality (order-independent).
 */
function areReposEqual(
  a: Array<{ repositoryUrl: string }>,
  b: Array<{ repositoryUrl: string }>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const urlsA = new Set(a.map((r) => r.repositoryUrl));
  const urlsB = new Set(b.map((r) => r.repositoryUrl));

  if (urlsA.size !== urlsB.size) {
    return false;
  }

  for (const url of urlsA) {
    if (!urlsB.has(url)) {
      return false;
    }
  }

  return true;
}
