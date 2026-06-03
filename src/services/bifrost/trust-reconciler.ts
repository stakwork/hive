import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";

import { BifrostHttpError } from "./BifrostClient";
import { BifrostPluginClient } from "./BifrostPluginClient";
import {
  BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_TRUST_LOCK_PREFIX,
  BIFROST_TRUST_LOCK_TTL_MS,
  BIFROST_TRUST_LOG_TAG,
  DEFAULT_REVOCATION_POLL_SECONDS,
} from "./constants";
import {
  ensureMacaroonOrgKeys,
  MacaroonOrgKeysError,
  type MacaroonOrgKeys,
} from "./macaroon-org-keys";
import { deriveBifrostBaseUrl } from "./resolve";

/**
 * Phase-5 Hive trust reconciler (with phase-11 realm_id sync).
 *
 * For a `workspaceId`:
 *   1. Resolve its `SourceControlOrg` (may be null → no-op).
 *   2. `ensureMacaroonOrgKeys` for that org — autogenerates a
 *      custodial macaroon-signing keypair if missing.
 *   3. Check the `Swarm` row's content-addressed trust cache
 *      (`bifrostTrustedOrgId`, `bifrostTrustedPubkey`). If it
 *      matches the org's current `(macaroonOrgId, pubkey)`, return
 *      — no Bifrost HTTP. This is the hot path.
 *   4. Mismatch → acquire a per-workspace Redis lock, hit the
 *      plugin's `GET /_plugin/trust/status` (defensive — saves a
 *      POST if already in sync), then `POST /_plugin/trust` if the
 *      org isn't registered with this pubkey. Phase 11: while we
 *      have the status response in hand, also reconcile the
 *      swarm's `realm_id` against the workspace slug — one extra
 *      `PUT /_plugin/trust/realm_id` if they diverge. Stamp the
 *      Swarm row with the new (orgId, pubkey, syncedAt).
 *
 * Lazy-only: triggered from `getBifrostForLLM` (the master
 * reconciler in `services/bifrost/orchestrator.ts`) before
 * `reconcileBifrostVK`. Failure is logged and surfaced via the
 * return value (`status: "skipped" | "failed"`); the caller
 * decides whether to abort. In phase 5 the orchestrator swallows
 * because macaroon enforcement is off — the plugin still verifies
 * VKs and LLM calls succeed even if the trust registry is briefly
 * stale.
 *
 * The realm_id sync rides along on the cache-miss path only:
 * single-swarm deployments that never trip an org-pubkey change
 * also never trigger a realm_id round-trip. If an operator
 * manually clears the plugin's realm_id, the next time the
 * (orgId, pubkey) cache is invalidated (key rotation, new
 * workspace) the reconciler will re-publish it. For the rare
 * "force realm_id resync without rotating keys" case, an
 * operator can clear `Swarm.bifrostTrustedPubkey` to bust the
 * cache.
 *
 * See `gateway/plans/phases/phase-5-trust-registry.md` §"Hive's
 * reconciler addition" and
 * `gateway/plans/phases/phase-11-symmetric-recursive-authorization.md`
 * §"Where the swarm's realm_id lives".
 */

export type TrustReconcileStatus =
  /** Cache hit on Swarm row matched the org's current (orgId, pubkey). */
  | "cached"
  /** Plugin already had us registered correctly; cache updated. */
  | "already-registered"
  /** Plugin was missing or had a stale pubkey; we POSTed. */
  | "upserted"
  /** Workspace has no SourceControlOrg — nothing to register. */
  | "skipped-no-org"
  /** Workspace has no swarm or no swarmUrl — nothing to reach. */
  | "skipped-no-swarm"
  /** Workspace's swarm has no provisioning token — can't authenticate. */
  | "skipped-no-token"
  /** Reconcile attempted and failed; details in the error. */
  | "failed";

export interface TrustReconcileResult {
  workspaceId: string;
  status: TrustReconcileStatus;
  /** Populated unless `status` is one of the `skipped-*` variants. */
  macaroonOrgId?: string;
  /** Populated alongside `macaroonOrgId`. */
  macaroonOrgPubkey?: string;
  /** Set when `status === "failed"`. Already-logged; for caller diagnostics. */
  error?: Error;
}

export interface TrustReconcileOptions {
  /** Inject a plugin client (tests). */
  pluginClientFactory?: (opts: {
    baseUrl: string;
    provisioningToken: string;
  }) => BifrostPluginClient;
  /** Inject the macaroon-org-keys step (tests). */
  ensureKeysFn?: typeof ensureMacaroonOrgKeys;
  /**
   * `issuer_url` to store on the plugin's trust entry. Defaults to
   * `HIVE_PUBLIC_URL` (or `NEXTAUTH_URL` as a fallback). The plugin
   * doesn't actively poll this yet (revocation is phase 6+); the
   * field is required on the registration call and sets the future
   * polling cadence.
   */
  issuerUrlOverride?: string;
}

/**
 * Ensure the workspace's Bifrost plugin trusts the workspace's
 * macaroon org. Idempotent. Fast on cache hit (one DB read).
 *
 * Returns a `TrustReconcileResult` that distinguishes between
 * "cache hit", "wrote new state", "skipped for legitimate reasons",
 * and "failed" — so the caller can log meaningfully and surface
 * UX errors only on real failures.
 */
export async function ensureBifrostTrust(
  workspaceId: string,
  options: TrustReconcileOptions = {},
): Promise<TrustReconcileResult> {
  // Phase 11 reads `slug` too: the swarm's `realm_id` is published
  // to the plugin as the workspace slug (human-readable identifier,
  // grep-friendly in logs). See `syncLocked` for the realm_id sync
  // logic.
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, slug: true, sourceControlOrgId: true },
  });
  if (!ws) {
    return { workspaceId, status: "skipped-no-org" };
  }
  if (!ws.sourceControlOrgId) {
    return { workspaceId, status: "skipped-no-org" };
  }

  // 1. Autogen org keypair if missing. This is per-org, not per-
  // workspace — multiple workspaces under the same org share one
  // keypair.
  let keys: MacaroonOrgKeys;
  try {
    const ensureKeysFn = options.ensureKeysFn ?? ensureMacaroonOrgKeys;
    keys = await ensureKeysFn(ws.sourceControlOrgId);
  } catch (err) {
    return failed(workspaceId, asError(err), {
      sourceControlOrgId: ws.sourceControlOrgId,
      stage: "ensure-keys",
    });
  }

  // 2. Read swarm + cached trust state.
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      swarmUrl: true,
      swarmApiKey: true,
      bifrostTrustedOrgId: true,
      bifrostTrustedPubkey: true,
      bifrostTrustSyncedAt: true,
    },
  });
  if (!swarm || !swarm.swarmUrl) {
    return {
      workspaceId,
      status: "skipped-no-swarm",
      macaroonOrgId: keys.macaroonOrgId,
      macaroonOrgPubkey: keys.macaroonOrgPubkey,
    };
  }
  if (!swarm.swarmApiKey) {
    return {
      workspaceId,
      status: "skipped-no-token",
      macaroonOrgId: keys.macaroonOrgId,
      macaroonOrgPubkey: keys.macaroonOrgPubkey,
    };
  }

  // 3. Content-addressed cache check. The pubkey is the heart of
  // the cache key — if the org rotated keys (rare in phase 1), this
  // mismatch is what catches it. We compare lowercased because the
  // plugin canonicalises to lowercase on its side and we want a
  // stable string match.
  const cachedOrgId = swarm.bifrostTrustedOrgId;
  const cachedPubkey = normalisePubkey(swarm.bifrostTrustedPubkey);
  const desiredPubkey = normalisePubkey(keys.macaroonOrgPubkey);
  if (
    cachedOrgId === keys.macaroonOrgId &&
    cachedPubkey &&
    cachedPubkey === desiredPubkey
  ) {
    return {
      workspaceId,
      status: "cached",
      macaroonOrgId: keys.macaroonOrgId,
      macaroonOrgPubkey: keys.macaroonOrgPubkey,
    };
  }

  // 4. Cache miss → take the lock, decrypt the token, talk to the
  // plugin. Serializes concurrent callers per workspace; the second
  // caller falls through to the cache hit above on re-read.
  const lockKey = `${BIFROST_TRUST_LOCK_PREFIX}:${workspaceId}`;
  try {
    return await withLock(
      lockKey,
      () =>
        syncLocked(
          workspaceId,
          swarm.swarmUrl!,
          swarm.swarmApiKey!,
          keys,
          ws.slug,
          options,
        ),
      {
        ttlMs: BIFROST_TRUST_LOCK_TTL_MS,
        acquireTimeoutMs: BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
      },
    );
  } catch (err) {
    return failed(workspaceId, asError(err), {
      sourceControlOrgId: ws.sourceControlOrgId,
      stage: "lock-or-sync",
    });
  }
}

async function syncLocked(
  workspaceId: string,
  swarmUrl: string,
  encryptedToken: string,
  keys: MacaroonOrgKeys,
  desiredRealmId: string,
  options: TrustReconcileOptions,
): Promise<TrustReconcileResult> {
  // Re-check the cache inside the lock — a racing caller may have
  // just synced.
  const fresh = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      bifrostTrustedOrgId: true,
      bifrostTrustedPubkey: true,
    },
  });
  if (
    fresh?.bifrostTrustedOrgId === keys.macaroonOrgId &&
    normalisePubkey(fresh?.bifrostTrustedPubkey) ===
      normalisePubkey(keys.macaroonOrgPubkey)
  ) {
    return {
      workspaceId,
      status: "cached",
      macaroonOrgId: keys.macaroonOrgId,
      macaroonOrgPubkey: keys.macaroonOrgPubkey,
    };
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

  const issuerUrl = resolveIssuerUrl(options.issuerUrlOverride);

  // GET status first — cheap, and skips the POST when the plugin is
  // already in sync (e.g. because Hive synced from a different
  // process recently and our local cache just hadn't picked it up).
  // Also confirms auth works before we attempt a mutation.
  let status: Awaited<ReturnType<BifrostPluginClient["getTrustStatus"]>>;
  try {
    status = await client.getTrustStatus();
  } catch (err) {
    throw wrapHttpError(err, "GET /_plugin/trust/status");
  }

  // Phase 11: reconcile the swarm's `realm_id` against the workspace
  // slug while we have the status in hand. The plugin's status
  // response omits the field when unset, so `??""` normalises the
  // single-swarm case. We only PUT on actual divergence to keep this
  // a no-op on warm reconciles. Empty `desiredRealmId` (defensive —
  // `Workspace.slug` is NOT NULL) leaves the plugin's value alone
  // rather than clearing it, since clearing is an explicit operator
  // intent we shouldn't infer from missing data.
  if (desiredRealmId && (status.realm_id ?? "") !== desiredRealmId) {
    try {
      await client.setRealmId(desiredRealmId);
      logger.info(
        "Bifrost trust realm_id updated",
        BIFROST_TRUST_LOG_TAG,
        {
          workspaceId,
          previousRealmId: status.realm_id ?? "",
          newRealmId: desiredRealmId,
        },
      );
    } catch (err) {
      throw wrapHttpError(err, "PUT /_plugin/trust/realm_id");
    }
  }

  // If the org is already in the list, do a precise GET to compare
  // pubkeys. The plugin's status response only carries org_ids, not
  // pubkeys, so we need the detail view to decide whether to upsert.
  const orgPresent = status.orgs.includes(keys.macaroonOrgId);
  if (orgPresent) {
    let row: Awaited<ReturnType<BifrostPluginClient["getTrustOrg"]>>;
    try {
      row = await client.getTrustOrg(keys.macaroonOrgId);
    } catch (err) {
      throw wrapHttpError(
        err,
        `GET /_plugin/trust/${keys.macaroonOrgId}`,
      );
    }
    if (row && normalisePubkey(row.pubkey) === normalisePubkey(keys.macaroonOrgPubkey)) {
      // Plugin already has the correct pubkey — just refresh the
      // cache on our side.
      await stampCache(workspaceId, keys);
      logger.info("Bifrost trust already registered", BIFROST_TRUST_LOG_TAG, {
        workspaceId,
        macaroonOrgId: keys.macaroonOrgId,
      });
      return {
        workspaceId,
        status: "already-registered",
        macaroonOrgId: keys.macaroonOrgId,
        macaroonOrgPubkey: keys.macaroonOrgPubkey,
      };
    }
    // else fall through to upsert with the correct pubkey.
  }

  try {
    await client.upsertTrust({
      org_id: keys.macaroonOrgId,
      pubkey: keys.macaroonOrgPubkey,
      issuer_url: issuerUrl,
      revocation_poll_seconds: DEFAULT_REVOCATION_POLL_SECONDS,
    });
  } catch (err) {
    throw wrapHttpError(err, "POST /_plugin/trust");
  }

  await stampCache(workspaceId, keys);
  logger.info("Bifrost trust upserted", BIFROST_TRUST_LOG_TAG, {
    workspaceId,
    macaroonOrgId: keys.macaroonOrgId,
    pubkey: keys.macaroonOrgPubkey,
    issuerUrl,
  });

  return {
    workspaceId,
    status: "upserted",
    macaroonOrgId: keys.macaroonOrgId,
    macaroonOrgPubkey: keys.macaroonOrgPubkey,
  };
}

async function stampCache(
  workspaceId: string,
  keys: MacaroonOrgKeys,
): Promise<void> {
  await db.swarm.update({
    where: { workspaceId },
    data: {
      bifrostTrustedOrgId: keys.macaroonOrgId,
      bifrostTrustedPubkey: keys.macaroonOrgPubkey.toLowerCase(),
      bifrostTrustSyncedAt: new Date(),
    },
  });
}

function resolveIssuerUrl(override?: string): string {
  if (override !== undefined) return override;
  // Phase 5: the plugin stores this but doesn't poll it yet. Pick
  // a reasonable default so the field is populated for phase 6.
  return (
    process.env.HIVE_PUBLIC_URL ??
    process.env.NEXTAUTH_URL ??
    ""
  );
}

function normalisePubkey(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/^0x/, "");
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
  context: Record<string, unknown>,
): TrustReconcileResult {
  // Log at warn (not error) — phase-5 trust reconcile is best-effort
  // and the caller (getBifrostForLLM in orchestrator.ts) swallows
  // the failure. Macaroon enforcement is still off, so this doesn't
  // break LLM calls; it just means the plugin's trust registry
  // won't be in sync if/when enforcement turns on.
  logger.warn("Bifrost trust reconcile failed", BIFROST_TRUST_LOG_TAG, {
    workspaceId,
    ...context,
    error: err.message,
  });
  // Re-export the MacaroonOrgKeysError sentinel so callers /
  // tests can distinguish keygen failures cleanly without
  // depending on the keys module directly.
  return { workspaceId, status: "failed", error: err };
}

// Re-export for callers that want to distinguish keygen errors
// from network/HTTP errors.
export { MacaroonOrgKeysError };
