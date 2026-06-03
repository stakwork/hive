import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";

import {
  BIFROST_HTTP_TIMEOUT_MS,
  BIFROST_LOG_TAG,
} from "./constants";
import { BifrostConfigError, deriveBifrostBaseUrl } from "./resolve";

/**
 * Phase-3 Bifrost admin-credential bootstrap.
 *
 * On a fresh swarm we don't yet know what password sphinx-swarm
 * generated for the Bifrost admin user. The gateway image's wrapper
 * exposes `GET /_plugin/admin-credentials` on its public port, gated
 * by a Bearer token whose value matches Boltwall's `stakwork_secret`
 * (= `swarm.swarmApiKey` in Hive). We:
 *
 *  1. Decrypt `swarm.swarmApiKey` (the shared secret).
 *  2. GET `/_plugin/admin-credentials` with that token.
 *  3. Save the returned admin user/password (encrypted) onto the
 *     Swarm row so `resolveBifrost` can return them on subsequent
 *     calls without going back to the gateway.
 *
 * Idempotent: a second call against a healthy gateway returns the
 * same plaintext and overwrites the same encrypted blob. A 401 from
 * the gateway means the provisioning token in swarm config doesn't
 * match what the gateway booted with — a config error, not a
 * transient failure.
 *
 * See gateway/plans/phases/phase-3-swarm-handoff.md §B2.1.
 */

const BOOTSTRAP_FETCH_TIMEOUT_MS = BIFROST_HTTP_TIMEOUT_MS;

interface AdminCredentialsResponse {
  admin_username: string;
  admin_password: string;
}

export interface BootstrapResult {
  baseUrl: string;
  adminUser: string;
  /** Plaintext admin password as returned by the gateway. */
  adminPassword: string;
}

/**
 * Fetch admin credentials from the workspace's Bifrost gateway and
 * persist them (encrypted) on the Swarm row.
 *
 * @throws {BifrostConfigError} if the swarm row is missing, has no
 * swarmUrl/swarmApiKey, or the gateway rejects/can't be reached.
 */
export async function bootstrapAdminCreds(
  workspaceId: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BootstrapResult> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { id: true, swarmUrl: true, swarmApiKey: true },
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
  if (!swarm.swarmApiKey) {
    throw new BifrostConfigError(
      `Swarm for workspace ${workspaceId} has no swarmApiKey ` +
        `(provisioning token); cannot bootstrap Bifrost admin creds`,
    );
  }

  const encryption = EncryptionService.getInstance();

  let provisioningToken: string;
  try {
    provisioningToken = encryption.decryptField(
      "swarmApiKey",
      swarm.swarmApiKey,
    );
  } catch (err) {
    throw new BifrostConfigError(
      `Failed to decrypt swarmApiKey for workspace ${workspaceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const baseUrl = deriveBifrostBaseUrl(swarm.swarmUrl);
  const credsUrl = `${baseUrl}/_plugin/admin-credentials`;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BOOTSTRAP_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(credsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${provisioningToken}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new BifrostConfigError(
        `Bifrost admin-credentials fetch timed out after ${timeoutMs}ms ` +
          `(workspace ${workspaceId}, url ${credsUrl})`,
      );
    }
    throw new BifrostConfigError(
      `Bifrost admin-credentials fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Read body for diagnostics but truncate so a misbehaving upstream
    // can't blow up the error message.
    const detail = await safeReadText(response, 200);
    throw new BifrostConfigError(
      `Bifrost admin-credentials returned ${response.status} ` +
        `(workspace ${workspaceId}): ${detail}`,
    );
  }

  let body: AdminCredentialsResponse;
  try {
    body = (await response.json()) as AdminCredentialsResponse;
  } catch (err) {
    throw new BifrostConfigError(
      `Bifrost admin-credentials returned non-JSON body: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (
    !body ||
    typeof body.admin_username !== "string" ||
    typeof body.admin_password !== "string" ||
    body.admin_password.length === 0
  ) {
    throw new BifrostConfigError(
      `Bifrost admin-credentials returned an unexpected payload shape ` +
        `(workspace ${workspaceId})`,
    );
  }

  // Persist encrypted; matches the swarmApiKey/swarmPassword idiom
  // used throughout services/swarm/db.ts.
  const encryptedPassword = JSON.stringify(
    encryption.encryptField("bifrostAdminPassword", body.admin_password),
  );

  await db.swarm.update({
    where: { workspaceId },
    data: {
      bifrostAdminUser: body.admin_username,
      bifrostAdminPassword: encryptedPassword,
    },
  });

  logger.info("Bootstrapped Bifrost admin credentials", BIFROST_LOG_TAG, {
    workspaceId,
    swarmId: swarm.id,
    baseUrl,
    adminUser: body.admin_username,
  });

  return {
    baseUrl,
    adminUser: body.admin_username,
    adminPassword: body.admin_password,
  };
}

async function safeReadText(res: Response, max: number): Promise<string> {
  try {
    const text = await res.text();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return "<no body>";
  }
}
