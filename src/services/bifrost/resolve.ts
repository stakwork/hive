import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { BifrostAdminCreds } from "./types";
import { DEFAULT_BIFROST_PORT } from "./constants";

/**
 * Derive Bifrost's base URL from a swarm URL.
 *
 * Rule: keep scheme, keep host, replace (or set) port to
 * `DEFAULT_BIFROST_PORT` (8181). Bifrost is co-deployed with the
 * swarm and reachable on a sibling port.
 *
 * Examples:
 *   https://swarm-abc.sphinx.chat        -> https://swarm-abc.sphinx.chat:8181
 *   https://swarm-abc.sphinx.chat:3355   -> https://swarm-abc.sphinx.chat:8181
 *   http://localhost:3355                 -> http://localhost:8181
 *   http://10.0.0.1                       -> http://10.0.0.1:8181
 *
 * If the input isn't a parseable URL, throws.
 */
export function deriveBifrostBaseUrl(
  swarmUrl: string,
  port: number = DEFAULT_BIFROST_PORT,
): string {
  let parsed: URL;
  try {
    parsed = new URL(swarmUrl);
  } catch {
    throw new Error(`Invalid swarmUrl: ${swarmUrl}`);
  }

  parsed.port = String(port);
  // Strip any trailing slash for predictability.
  return parsed.toString().replace(/\/$/, "");
}

export class BifrostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BifrostConfigError";
  }
}

/**
 * Look up the Bifrost admin credentials + base URL for a workspace.
 * Throws `BifrostConfigError` if any piece is missing or misconfigured.
 */
export async function resolveBifrost(
  workspaceId: string,
): Promise<BifrostAdminCreds> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      swarmUrl: true,
      bifrostAdminUser: true,
      bifrostAdminPassword: true,
    },
  });

  if (!swarm) {
    throw new BifrostConfigError(
      `No swarm configured for workspace ${workspaceId}`,
    );
  }
  if (!swarm.swarmUrl) {
    throw new BifrostConfigError(
      `Swarm for workspace ${workspaceId} has no swarmUrl`,
    );
  }
  if (!swarm.bifrostAdminUser || !swarm.bifrostAdminPassword) {
    throw new BifrostConfigError(
      `Swarm for workspace ${workspaceId} is missing Bifrost admin credentials`,
    );
  }

  const baseUrl = deriveBifrostBaseUrl(swarm.swarmUrl);

  // `decryptField` handles raw JSON-string ciphertext or plaintext
  // (migration safety) — match the idiom used everywhere else in the
  // codebase rather than parsing ourselves.
  const encryption = EncryptionService.getInstance();
  let adminPassword: string;
  try {
    adminPassword = encryption.decryptField(
      "bifrostAdminPassword",
      swarm.bifrostAdminPassword,
    );
  } catch (err) {
    throw new BifrostConfigError(
      `Failed to decrypt Bifrost admin password for workspace ${workspaceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    baseUrl,
    adminUser: swarm.bifrostAdminUser,
    adminPassword,
  };
}
