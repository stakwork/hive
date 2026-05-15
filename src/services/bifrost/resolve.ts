import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { BifrostAdminCreds } from "./types";
import { DEFAULT_BIFROST_PORT } from "./constants";

// `bootstrap.ts` imports from this file, so we cannot eagerly import
// it here without creating a cycle. Resolve lazily inside the function
// that needs it.

/**
 * Derive Bifrost's base URL from a swarm URL.
 *
 * Rule: keep scheme + host, replace (or set) port to
 * `DEFAULT_BIFROST_PORT` (8181), and strip path / query / hash.
 * The gateway is a sibling listener on the same host — its routes
 * (`/health`, `/_plugin/*`, `/api/governance/*`, `/v1/*`) all live at
 * the root, not under whatever path the swarm's API happens to use.
 *
 * Examples:
 *   https://swarm-abc.sphinx.chat        -> https://swarm-abc.sphinx.chat:8181
 *   https://swarm-abc.sphinx.chat/api    -> https://swarm-abc.sphinx.chat:8181
 *   https://swarm-abc.sphinx.chat:3355   -> https://swarm-abc.sphinx.chat:8181
 *   http://localhost:3355                -> http://localhost:8181
 *   http://10.0.0.1                      -> http://10.0.0.1:8181
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

  // Build origin-only: scheme://host:port. Drops path / query / hash
  // — the gateway's routes live at the root, not under the swarm's
  // `/api` (or any other path).
  return `${parsed.protocol}//${parsed.hostname}:${port}`;
}

export class BifrostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BifrostConfigError";
  }
}

/**
 * Look up the Bifrost admin credentials + base URL for a workspace.
 *
 * If the swarm row is missing `bifrostAdminUser` / `bifrostAdminPassword`
 * (fresh swarm, never bootstrapped), this calls
 * `bootstrapAdminCreds` lazily: that hits the gateway's
 * `/_plugin/admin-credentials` endpoint (Bearer-gated by the
 * provisioning token) and persists the result on the Swarm row.
 *
 * Throws `BifrostConfigError` if the swarm row is missing entirely,
 * has no swarmUrl, or the bootstrap step fails.
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

  // Lazy bootstrap. The gateway is the source of truth for the admin
  // password; we cache it (encrypted) on the swarm row. First call
  // after a fresh swarm provisioning fills it in.
  if (!swarm.bifrostAdminUser || !swarm.bifrostAdminPassword) {
    const { bootstrapAdminCreds } = await import("./bootstrap");
    return bootstrapAdminCreds(workspaceId);
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
