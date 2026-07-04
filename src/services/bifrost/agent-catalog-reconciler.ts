import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";

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
}

export async function ensureBifrostAgentCatalog(
  workspaceId: string,
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
          manifest,
          hash,
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
  manifest: AgentCatalogManifest,
  hash: string,
  options: AgentCatalogReconcileOptions,
): Promise<AgentCatalogReconcileResult> {
  // Re-check inside the lock — a racing caller may have just seeded.
  const fresh = await db.swarm.findUnique({
    where: { workspaceId },
    select: { bifrostAgentsSeedHash: true },
  });
  if (fresh?.bifrostAgentsSeedHash === hash) {
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

  return { workspaceId, status: "seeded", hash };
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
