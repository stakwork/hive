import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";
import { createApiKey } from "@/lib/api-keys";

import {
  agentCatalogManifestHash,
  buildAgentCatalogManifest,
  loadAgentPromptNames,
} from "./agent-catalog";
import type { AgentCatalogManifest } from "./types";
import { BifrostHttpError } from "./BifrostClient";
import { BifrostPluginClient } from "./BifrostPluginClient";
import {
  BIFROST_AGENT_CATALOG_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_AGENT_CATALOG_LOCK_PREFIX,
  BIFROST_AGENT_CATALOG_LOCK_TTL_MS,
  BIFROST_AGENT_CATALOG_LOG_TAG,
} from "./constants";
import { deriveBifrostBaseUrl } from "./resolve";

/**
 * Agent-catalog seed reconciler.
 *
 * Pushes Hive's default agent set (names + default model) into the
 * workspace's gateway neo4j catalog via `POST /_plugin/agents`. The
 * catalog is the source of truth for what each agent *is*; Hive's
 * `BIFROST_AGENT_NAMES` is the source of truth for which agents
 * *exist*. This reconciler keeps the former in sync with the latter.
 *
 * Mirrors `ensureBifrostTrust`'s shape:
 *   - content-addressed cache on the `Swarm` row
 *     (`bifrostAgentsSeedHash`) — a manifest change flips the hash and
 *     re-seeds; otherwise the hot path is a couple of DB reads (the
 *     `Prompt.agentNames` links + the `Swarm` row) and no HTTP.
 *   - per-workspace Redis lock around the actual push.
 *   - lazy-only, triggered from `getBifrostForLLM` after the trust
 *     reconcile. Best-effort: failures are logged and surfaced via the
 *     return status; the orchestrator swallows them (a stale catalog
 *     never blocks an LLM call).
 *
 * Additionally, on both the fresh-seed and "cached" paths, this
 * reconciler ensures a "gateway-evals" API key is provisioned and
 * pushed to the gateway via `POST /_plugin/hive-callback`. This lets
 * the gateway call back into Hive for eval mutations/runs. The check
 * is gated on `gatewayHiveKeyId` being null or its
 * `WorkspaceApiKey` row being missing/revoked — NOT on the seed hash.
 * The callback push is non-fatal: failures are logged and the
 * `gatewayHiveKeyId` is NOT persisted, so the next reconcile retries.
 */

export type AgentCatalogReconcileStatus =
  /** Swarm row's hash matched the current manifest — no HTTP. */
  | "cached"
  /** Manifest pushed and the hash stamped. */
  | "seeded"
  /** Workspace has no swarm or no swarmUrl — nothing to reach. */
  | "skipped-no-swarm"
  /** Swarm has no provisioning token — can't authenticate. */
  | "skipped-no-token"
  /** Attempted and failed; details in the error. */
  | "failed";

export interface AgentCatalogReconcileResult {
  workspaceId: string;
  status: AgentCatalogReconcileStatus;
  /** Manifest hash that is now (or was already) live. */
  hash?: string;
  /** Set when `status === "failed"`. Already logged. */
  error?: Error;
}

export interface AgentCatalogReconcileOptions {
  /** Inject a plugin client (tests). */
  pluginClientFactory?: (opts: {
    baseUrl: string;
    provisioningToken: string;
  }) => BifrostPluginClient;
  /**
   * Override the createApiKey implementation (tests).
   * Signature mirrors `src/lib/api-keys.ts#createApiKey`.
   */
  createApiKeyFn?: typeof createApiKey;
}

export async function ensureBifrostAgentCatalog(
  workspaceId: string,
  createdById?: string,
  options: AgentCatalogReconcileOptions = {},
): Promise<AgentCatalogReconcileResult> {
  const promptsByAgent = await loadAgentPromptNames();
  const manifest = buildAgentCatalogManifest(promptsByAgent);
  const hash = agentCatalogManifestHash(manifest);

  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      swarmUrl: true,
      swarmApiKey: true,
      bifrostAgentsSeedHash: true,
      gatewayHiveKeyId: true,
    },
  });
  if (!swarm || !swarm.swarmUrl) {
    return { workspaceId, status: "skipped-no-swarm" };
  }
  if (!swarm.swarmApiKey) {
    return { workspaceId, status: "skipped-no-token" };
  }

  // Content-addressed cache hit — the gateway already has this exact
  // manifest. Hot path: no lock, no HTTP.
  if (swarm.bifrostAgentsSeedHash === hash) {
    // Even on the cached path we still need to check whether the
    // gateway callback key is provisioned — the seed-hash cache is
    // orthogonal to the callback provisioning state.
    if (createdById) {
      await maybeProvisionCallbackKey(
        workspaceId,
        swarm.swarmUrl,
        swarm.swarmApiKey,
        swarm.gatewayHiveKeyId,
        createdById,
        options,
      );
    }
    return { workspaceId, status: "cached", hash };
  }

  const lockKey = `${BIFROST_AGENT_CATALOG_LOCK_PREFIX}:${workspaceId}`;
  try {
    return await withLock(
      lockKey,
      () =>
        seedLocked(
          workspaceId,
          swarm.swarmUrl!,
          swarm.swarmApiKey!,
          swarm.gatewayHiveKeyId,
          manifest,
          hash,
          createdById,
          options,
        ),
      {
        ttlMs: BIFROST_AGENT_CATALOG_LOCK_TTL_MS,
        acquireTimeoutMs: BIFROST_AGENT_CATALOG_LOCK_ACQUIRE_TIMEOUT_MS,
      },
    );
  } catch (err) {
    return failed(workspaceId, asError(err));
  }
}

async function seedLocked(
  workspaceId: string,
  swarmUrl: string,
  encryptedToken: string,
  gatewayHiveKeyId: string | null,
  manifest: AgentCatalogManifest,
  hash: string,
  createdById: string | undefined,
  options: AgentCatalogReconcileOptions,
): Promise<AgentCatalogReconcileResult> {
  // Re-check inside the lock — a racing caller may have just seeded.
  const fresh = await db.swarm.findUnique({
    where: { workspaceId },
    select: { bifrostAgentsSeedHash: true, gatewayHiveKeyId: true },
  });
  if (fresh?.bifrostAgentsSeedHash === hash) {
    // Same as the outer cached-path: still check callback provisioning.
    if (createdById) {
      await maybeProvisionCallbackKey(
        workspaceId,
        swarmUrl,
        encryptedToken,
        fresh.gatewayHiveKeyId,
        createdById,
        options,
      );
    }
    return { workspaceId, status: "cached", hash };
  }

  const encryption = EncryptionService.getInstance();
  let provisioningToken: string;
  try {
    provisioningToken = encryption.decryptField("swarmApiKey", encryptedToken);
  } catch (err) {
    throw new Error(
      `Failed to decrypt swarmApiKey for workspace ${workspaceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const baseUrl = deriveBifrostBaseUrl(swarmUrl);
  const client =
    options.pluginClientFactory?.({ baseUrl, provisioningToken }) ??
    new BifrostPluginClient({ baseUrl, provisioningToken });

  // `manifest` is the exact object that was hashed by the caller, so
  // the bytes we push and the bytes we stamped the hash on are the same.
  let written: Awaited<ReturnType<BifrostPluginClient["seedAgentCatalog"]>>;
  try {
    written = await client.seedAgentCatalog(manifest);
  } catch (err) {
    // 503 = catalog not configured (neo4j unset on this swarm). Treat
    // as a benign skip rather than a failure — the swarm simply isn't
    // wired for the catalog, and we don't want to retry-spam it. We
    // deliberately do NOT stamp the hash, so if neo4j is later wired
    // the next call seeds.
    if (err instanceof BifrostHttpError && err.status === 503) {
      logger.info(
        "Bifrost agent catalog not configured on swarm; skipping seed",
        BIFROST_AGENT_CATALOG_LOG_TAG,
        { workspaceId },
      );
      return { workspaceId, status: "skipped-no-swarm", hash };
    }
    throw wrapHttpError(err, "POST /_plugin/agents");
  }

  await db.swarm.update({
    where: { workspaceId },
    data: {
      bifrostAgentsSeedHash: hash,
      bifrostAgentsSeedAt: new Date(),
    },
  });

  logger.info("Bifrost agent catalog seeded", BIFROST_AGENT_CATALOG_LOG_TAG, {
    workspaceId,
    hash,
    written: written.written,
  });

  // Provision/push the gateway callback key after a successful seed.
  // Uses the already-resolved client (same provisioning token).
  if (createdById) {
    await maybeProvisionCallbackKey(
      workspaceId,
      swarmUrl,
      encryptedToken,
      gatewayHiveKeyId,
      createdById,
      options,
      client,
    );
  }

  return { workspaceId, status: "seeded", hash };
}

/**
 * Mint-once, re-mint-on-missing/revoked gateway callback provisioner.
 *
 * Checks whether a "gateway-evals" API key is already provisioned and
 * valid. If not (null `gatewayHiveKeyId`, missing row, or revoked key),
 * mints a fresh key and pushes it to the gateway via
 * `POST /_plugin/hive-callback`. Persists `gatewayHiveKeyId` only after
 * a successful push, so a push failure triggers a retry on the next
 * reconcile.
 *
 * Entirely non-fatal: all errors are caught, logged, and swallowed.
 * The caller (catalog seed reconciler) must never throw from here.
 */
async function maybeProvisionCallbackKey(
  workspaceId: string,
  swarmUrl: string,
  encryptedToken: string,
  gatewayHiveKeyId: string | null,
  createdById: string,
  options: AgentCatalogReconcileOptions,
  existingClient?: BifrostPluginClient,
): Promise<void> {
  try {
    // Read directly from process.env — optionalEnvVars is a static
    // snapshot captured at module load time and would not reflect
    // runtime changes (e.g. in tests or Vercel env injection).
    const hivePublicUrl = process.env.HIVE_PUBLIC_URL || "";
    if (!hivePublicUrl) {
      logger.warn(
        "HIVE_PUBLIC_URL is not set; skipping gateway callback provisioning",
        BIFROST_AGENT_CATALOG_LOG_TAG,
        { workspaceId },
      );
      return;
    }

    // Check if we already have a valid (non-revoked) key.
    if (gatewayHiveKeyId) {
      const existingKey = await db.workspaceApiKey.findUnique({
        where: { id: gatewayHiveKeyId },
        select: { id: true, revokedAt: true },
      });
      if (existingKey && !existingKey.revokedAt) {
        logger.info(
          "Gateway callback key already provisioned; skipping",
          BIFROST_AGENT_CATALOG_LOG_TAG,
          { workspaceId, keyId: gatewayHiveKeyId },
        );
        return;
      }
      // Key is missing or revoked — fall through to re-mint.
      logger.info(
        "Gateway callback key missing or revoked; re-minting",
        BIFROST_AGENT_CATALOG_LOG_TAG,
        { workspaceId, keyId: gatewayHiveKeyId },
      );
    }

    // Mint a new "gateway-evals" API key.
    const createFn = options.createApiKeyFn ?? createApiKey;
    const minted = await createFn({
      workspaceId,
      name: "gateway-evals",
      createdById,
    });

    logger.info(
      "Gateway callback key minted",
      BIFROST_AGENT_CATALOG_LOG_TAG,
      { workspaceId, keyId: minted.id },
    );

    // Resolve the plugin client (reuse the one from seedLocked if supplied).
    let client = existingClient;
    if (!client) {
      const encryption = EncryptionService.getInstance();
      const provisioningToken = encryption.decryptField(
        "swarmApiKey",
        encryptedToken,
      );
      const baseUrl = deriveBifrostBaseUrl(swarmUrl);
      client =
        options.pluginClientFactory?.({ baseUrl, provisioningToken }) ??
        new BifrostPluginClient({ baseUrl, provisioningToken });
    }

    // Push callback config to the gateway.
    const response = await client.pushHiveCallback({
      hive_url: hivePublicUrl,
      api_key: minted.key,
    });

    if (!response.ok) {
      logger.warn(
        "Gateway rejected Hive callback push (ok=false); not persisting key",
        BIFROST_AGENT_CATALOG_LOG_TAG,
        { workspaceId, keyId: minted.id },
      );
      return;
    }

    // Persist only after a confirmed successful push.
    await db.swarm.update({
      where: { workspaceId },
      data: { gatewayHiveKeyId: minted.id },
    });

    logger.info(
      "Gateway callback config pushed and key persisted",
      BIFROST_AGENT_CATALOG_LOG_TAG,
      { workspaceId, keyId: minted.id },
    );
  } catch (err) {
    // Non-fatal: log and continue. gatewayHiveKeyId is NOT persisted on
    // failure, so the next reconcile will retry.
    logger.warn(
      "Gateway callback provisioning failed; will retry on next reconcile",
      BIFROST_AGENT_CATALOG_LOG_TAG,
      {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

function wrapHttpError(err: unknown, op: string): Error {
  if (err instanceof BifrostHttpError) {
    return new Error(`${op}: ${err.message}`);
  }
  if (err instanceof Error) return new Error(`${op}: ${err.message}`);
  return new Error(`${op}: ${String(err)}`);
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function failed(
  workspaceId: string,
  err: Error,
): AgentCatalogReconcileResult {
  // Warn (not error) — best-effort, swallowed by the orchestrator.
  logger.warn(
    "Bifrost agent catalog seed failed",
    BIFROST_AGENT_CATALOG_LOG_TAG,
    { workspaceId, error: err.message },
  );
  return { workspaceId, status: "failed", error: err };
}
