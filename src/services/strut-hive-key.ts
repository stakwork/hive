/**
 * Hive credentials on a strut — the org API key a strut workflow uses to
 * call back into hive (claim/drop a pod, …).
 *
 * The key is the ORG's, not a person's, so it lives in strut's DEPLOYMENT
 * secret store (`PUT /secrets/:name`, `secrets.json`), not the per-actor
 * store: every run on that strut, with or without a principal, reads it as
 * `secrets.get("HIVE_API_KEY")`, next to `HIVE_URL`. One strut is one trust
 * domain (see `strut-target.ts`), and the embed's strut serves one org.
 *
 * Desired state is `Swarm.strutHiveKeyId` → a live `OrgApiKey` of the
 * swarm's org. Hive keeps only the key's hash, so a key strut lost is
 * never re-sent: it is REPLACED — push HIVE_URL, mint a new key, push it,
 * point the swarm at it, revoke the old one. HIVE_URL goes first so a key
 * is minted only once the lab has accepted a push; a failed key push
 * revokes the fresh key and leaves the pointer alone, so strut never holds
 * a key hive does not point at and the next attempt starts clean.
 *
 *   - `ensureStrutHiveKey` — on the org strut embed: mint + push when the
 *     swarm has no live key on record. DB-only when it does. Never throws.
 *   - `runStrutHiveKeyReconcile` — daily: for every swarm with a key on
 *     record, list strut's secret names; rotate when `HIVE_API_KEY` is
 *     gone (wiped volume, deleted in the Secrets dialog) or the key on
 *     record is revoked / expired / of another org; re-push a missing
 *     `HIVE_URL`. A swarm never embedded is left alone.
 *
 * Same headers as every lab call: mcp's gate reads `x-api-token`, strut's
 * `requireApiKey` the bearer — both the swarm API key. Never log a value.
 */

import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";
import { createOrgApiKey } from "@/lib/org-api-keys";
import { STRUT_DELEGATION_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";
import { strutLabBaseUrl, type StrutLabTarget } from "@/services/bifrost/strut-delegation";

export const STRUT_HIVE_KEY_LOG_TAG = "STRUT_HIVE_KEY";
export const STRUT_HIVE_KEY_SECRET = "HIVE_API_KEY";
export const STRUT_HIVE_URL_SECRET = "HIVE_URL";
/** `OrgApiKey.name` of the keys this module mints. */
export const STRUT_HIVE_KEY_NAME = "strut (managed)";

const LOCK_PREFIX = "strut-hive-key";
const LOCK_TTL_MS = 30_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

export type EnsureStrutHiveKeyStatus =
  /** A live key of the swarm's org is on record — nothing sent. */
  | "present"
  /** A new key was minted and pushed with HIVE_URL. */
  | "pushed"
  /** The swarm's workspace has no org; an org key has nothing to scope to. */
  | "skipped"
  /** The lab has no deployment-secret routes (404) or they are injected (501). */
  | "unsupported"
  /** Attempted and failed; logged. */
  | "failed";

export interface StrutHiveKeyTarget {
  swarmId: string;
  workspaceId: string;
  orgId: string | null;
  lab: StrutLabTarget;
}

type PushResult = "ok" | "unsupported" | "failed";

function labHeaders(lab: StrutLabTarget): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-token": lab.swarmApiKey,
    Authorization: `Bearer ${lab.swarmApiKey}`,
  };
}

/** `PUT /secrets/:name` on the strut's deployment store. */
export async function putStrutDeploymentSecret(
  lab: StrutLabTarget,
  name: string,
  value: string,
): Promise<PushResult> {
  try {
    const res = await fetch(`${lab.labBase}/secrets/${name}`, {
      method: "PUT",
      headers: labHeaders(lab),
      body: JSON.stringify({ value }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 501) return "unsupported";
    if (!res.ok) {
      logger.warn("Strut deployment secret push failed", STRUT_HIVE_KEY_LOG_TAG, {
        labBase: lab.labBase,
        name,
        status: res.status,
      });
      return "failed";
    }
    return "ok";
  } catch (err) {
    logger.warn("Strut deployment secret push threw", STRUT_HIVE_KEY_LOG_TAG, {
      labBase: lab.labBase,
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** `GET /secrets` → the deployment secret NAMES; null when the lab has no such route. Throws otherwise. */
export async function listStrutDeploymentSecretNames(lab: StrutLabTarget): Promise<Set<string> | null> {
  const res = await fetch(`${lab.labBase}/secrets`, {
    method: "GET",
    headers: labHeaders(lab),
    cache: "no-store",
    signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 501) return null;
  if (!res.ok) throw new Error(`GET /secrets returned ${res.status}`);
  const data = (await res.json()) as { secrets?: Array<{ name?: unknown }> };
  if (!Array.isArray(data?.secrets)) throw new Error("GET /secrets did not return a list");
  return new Set(data.secrets.map((s) => s?.name).filter((n): n is string => typeof n === "string"));
}

/** Is the key on record usable by this swarm's org right now? */
async function liveKeyOnRecord(keyId: string | null, orgId: string, now: Date) {
  if (!keyId) return null;
  const key = await db.orgApiKey.findUnique({
    where: { id: keyId },
    select: { id: true, sourceControlOrgId: true, revokedAt: true, expiresAt: true, createdById: true },
  });
  const live =
    !!key &&
    key.sourceControlOrgId === orgId &&
    !key.revokedAt &&
    (!key.expiresAt || key.expiresAt > now);
  return { key, live };
}

async function revokeKey(keyId: string, revokedById: string) {
  await db.orgApiKey.updateMany({
    where: { id: keyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById },
  });
}

/**
 * Push HIVE_URL, mint a fresh key for the swarm's org, push it, point the
 * swarm at it, revoke the previous one. Callers hold the swarm's lock.
 */
async function rotateStrutHiveKey(
  target: StrutHiveKeyTarget & { orgId: string },
  opts: { publicBaseUrl: string; createdById: string; previousKeyId: string | null },
): Promise<"pushed" | "unsupported" | "failed"> {
  // HIVE_URL first: it is no secret, and a key is minted only once the lab
  // has accepted a push. Key first and URL second left strut holding a key
  // that a failed second push then revoked, with nothing to notice it.
  const urlPushed = await putStrutDeploymentSecret(target.lab, STRUT_HIVE_URL_SECRET, opts.publicBaseUrl);
  if (urlPushed !== "ok") return urlPushed;

  const minted = await createOrgApiKey({
    orgId: target.orgId,
    name: STRUT_HIVE_KEY_NAME,
    createdById: opts.createdById,
  });

  const pushed = await putStrutDeploymentSecret(target.lab, STRUT_HIVE_KEY_SECRET, minted.key);
  if (pushed !== "ok") {
    // The raw key is gone with this frame; a key nobody holds is dead weight.
    await revokeKey(minted.id, opts.createdById);
    return pushed;
  }

  await db.swarm.update({ where: { id: target.swarmId }, data: { strutHiveKeyId: minted.id } });
  if (opts.previousKeyId && opts.previousKeyId !== minted.id) {
    await revokeKey(opts.previousKeyId, opts.createdById);
  }
  logger.info("Pushed a new hive key to strut", STRUT_HIVE_KEY_LOG_TAG, {
    swarmId: target.swarmId,
    workspaceId: target.workspaceId,
    orgId: target.orgId,
    keyId: minted.id,
    previousKeyId: opts.previousKeyId,
  });
  return "pushed";
}

/**
 * Embed-time: make sure the swarm's strut holds a live hive key. Cheap when
 * one is on record (one swarm read, one key read, no HTTP). Never throws.
 */
export async function ensureStrutHiveKey(
  target: StrutHiveKeyTarget,
  opts: { publicBaseUrl: string; userId: string },
): Promise<EnsureStrutHiveKeyStatus> {
  const { orgId } = target;
  if (!orgId) return "skipped";

  try {
    return await withLock(
      `${LOCK_PREFIX}:${target.swarmId}`,
      async () => {
        const swarm = await db.swarm.findUnique({
          where: { id: target.swarmId },
          select: { strutHiveKeyId: true },
        });
        const previousKeyId = swarm?.strutHiveKeyId ?? null;
        const onRecord = await liveKeyOnRecord(previousKeyId, orgId, new Date());
        if (onRecord?.live) return "present" as const;
        return rotateStrutHiveKey(
          { ...target, orgId },
          { publicBaseUrl: opts.publicBaseUrl, createdById: opts.userId, previousKeyId },
        );
      },
      { ttlMs: LOCK_TTL_MS, acquireTimeoutMs: LOCK_ACQUIRE_TIMEOUT_MS },
    );
  } catch (err) {
    logger.warn("ensureStrutHiveKey failed; embed proceeds", STRUT_HIVE_KEY_LOG_TAG, {
      swarmId: target.swarmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

// ── Daily reconcile ─────────────────────────────────────────────────────────

export interface StrutHiveKeyReconcileError {
  workspaceSlug: string;
  error: string;
}

export interface StrutHiveKeyReconcileResult {
  success: boolean;
  /** Swarms whose strut secrets were read. */
  swarmsProcessed: number;
  /** No usable swarm credentials, or no deployment-secret routes. */
  swarmsSkipped: number;
  /** New keys minted + pushed. */
  rotated: number;
  /** Keys revoked because the workspace left its org. */
  revoked: number;
  errors: StrutHiveKeyReconcileError[];
  timestamp: Date;
}

export async function runStrutHiveKeyReconcile(options: {
  publicBaseUrl: string;
  now?: Date;
  workspaceSlug?: string;
}): Promise<StrutHiveKeyReconcileResult> {
  const now = options.now ?? new Date();
  const result: StrutHiveKeyReconcileResult = {
    success: true,
    swarmsProcessed: 0,
    swarmsSkipped: 0,
    rotated: 0,
    revoked: 0,
    errors: [],
    timestamp: now,
  };

  const swarms = await db.swarm.findMany({
    where: {
      strutHiveKeyId: { not: null },
      workspace: {
        deleted: false,
        ...(options.workspaceSlug ? { slug: options.workspaceSlug } : {}),
      },
    },
    select: {
      id: true,
      swarmUrl: true,
      swarmApiKey: true,
      strutHiveKeyId: true,
      workspace: { select: { id: true, slug: true, ownerId: true, sourceControlOrgId: true } },
    },
  });

  const encryption = EncryptionService.getInstance();

  for (const swarm of swarms) {
    const ws = swarm.workspace;
    try {
      const orgId = ws.sourceControlOrgId;
      if (!orgId) {
        // No org to scope a key to any more: retire the one on record.
        await revokeKey(swarm.strutHiveKeyId!, ws.ownerId);
        await db.swarm.update({ where: { id: swarm.id }, data: { strutHiveKeyId: null } });
        result.revoked++;
        continue;
      }
      if (!swarm.swarmUrl || !swarm.swarmApiKey) {
        result.swarmsSkipped++;
        continue;
      }

      const lab: StrutLabTarget = {
        labBase: strutLabBaseUrl(swarm.swarmUrl),
        swarmApiKey: encryption.decryptField("swarmApiKey", swarm.swarmApiKey),
      };
      const target: StrutHiveKeyTarget & { orgId: string } = {
        swarmId: swarm.id,
        workspaceId: ws.id,
        orgId,
        lab,
      };

      const names = await listStrutDeploymentSecretNames(lab);
      if (!names) {
        result.swarmsSkipped++;
        continue;
      }
      result.swarmsProcessed++;

      const outcome = await withLock(
        `${LOCK_PREFIX}:${swarm.id}`,
        async () => {
          // Re-read under the lock: an embed may have rotated since the list.
          const fresh = await db.swarm.findUnique({ where: { id: swarm.id }, select: { strutHiveKeyId: true } });
          const previousKeyId = fresh?.strutHiveKeyId ?? null;
          const onRecord = await liveKeyOnRecord(previousKeyId, orgId, now);

          if (onRecord?.live && previousKeyId === swarm.strutHiveKeyId && names.has(STRUT_HIVE_KEY_SECRET)) {
            if (!names.has(STRUT_HIVE_URL_SECRET)) {
              const pushed = await putStrutDeploymentSecret(lab, STRUT_HIVE_URL_SECRET, options.publicBaseUrl);
              if (pushed !== "ok") throw new Error(`HIVE_URL push ${pushed}`);
            }
            return "ok" as const;
          }
          if (onRecord?.live && previousKeyId !== swarm.strutHiveKeyId) {
            // Rotated by an embed after our list; that push is authoritative.
            return "ok" as const;
          }

          return rotateStrutHiveKey(target, {
            publicBaseUrl: options.publicBaseUrl,
            createdById: onRecord?.key?.createdById ?? ws.ownerId,
            previousKeyId,
          });
        },
        { ttlMs: LOCK_TTL_MS, acquireTimeoutMs: LOCK_ACQUIRE_TIMEOUT_MS },
      );

      if (outcome === "pushed") result.rotated++;
      else if (outcome !== "ok") throw new Error(`rotation ${outcome}`);
    } catch (err) {
      result.errors.push({
        workspaceSlug: ws.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.success = result.errors.length === 0;
  logger.info("Strut hive key reconcile finished", STRUT_HIVE_KEY_LOG_TAG, {
    swarmsProcessed: result.swarmsProcessed,
    swarmsSkipped: result.swarmsSkipped,
    rotated: result.rotated,
    revoked: result.revoked,
    errors: result.errors.length,
  });
  return result;
}
