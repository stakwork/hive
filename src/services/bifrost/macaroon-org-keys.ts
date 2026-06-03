import * as secp from "@noble/secp256k1";

import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";

import {
  BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_TRUST_LOCK_TTL_MS,
  MACAROON_ORG_ID_PREFIX,
  MACAROON_ORG_LOCK_PREFIX,
  MACAROON_ORG_LOG_TAG,
} from "./constants";

/**
 * Phase-5 macaroon org keypair autogen.
 *
 * For a `SourceControlOrg` row, ensure it has a
 * `(macaroonOrgId, macaroonOrgPubkey, macaroonOrgPrivkey)` triple
 * stored. Generates a fresh secp256k1 keypair if any are missing.
 * Custodial — the privkey lives encrypted in Hive's DB through
 * phase 1 of `cryptographic-identity.md`. Phase 2+ migrates the
 * privkey off the platform.
 *
 * Triggered lazily from `ensureBifrostTrust`. After the first
 * successful run for an org, every subsequent call is a fast DB
 * read (no lock, no keygen).
 *
 * `macaroonOrgId` derives from `githubLogin` as `gh_<login>` and is
 * captured in the row at mint time. If GitHub later renames the
 * org, the macaroon org_id stays put — rename detection / re-mint
 * is a phase-6+ concern.
 */

export interface MacaroonOrgKeys {
  /** `SourceControlOrg.id`. */
  sourceControlOrgId: string;
  /** Stable macaroon-side org identifier, e.g. `gh_stakwork`. */
  macaroonOrgId: string;
  /** Hex-encoded 33-byte compressed secp256k1 pubkey (66 hex chars). */
  macaroonOrgPubkey: string;
  /** True iff the keypair was minted during this call (audit signal). */
  created: boolean;
}

export class MacaroonOrgKeysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacaroonOrgKeysError";
  }
}

/**
 * Look up (or generate) the macaroon keypair for a SourceControlOrg.
 *
 * Idempotent under a per-org Redis lock — concurrent callers wait
 * for the first one to finish, then read the row.
 *
 * @throws `MacaroonOrgKeysError` if the org doesn't exist or lacks a
 *   `githubLogin` (every real row has one — defensive).
 */
export async function ensureMacaroonOrgKeys(
  sourceControlOrgId: string,
): Promise<MacaroonOrgKeys> {
  // Fast path: row already has the triple. Avoids the lock on every
  // hot-path LLM call.
  const cached = await readOrg(sourceControlOrgId);
  if (
    cached.macaroonOrgId &&
    cached.macaroonOrgPubkey &&
    cached.macaroonOrgPrivkey
  ) {
    return {
      sourceControlOrgId,
      macaroonOrgId: cached.macaroonOrgId,
      macaroonOrgPubkey: cached.macaroonOrgPubkey,
      created: false,
    };
  }

  const lockKey = `${MACAROON_ORG_LOCK_PREFIX}:${sourceControlOrgId}`;
  return withLock(lockKey, () => mintLocked(sourceControlOrgId), {
    ttlMs: BIFROST_TRUST_LOCK_TTL_MS,
    acquireTimeoutMs: BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
  });
}

async function mintLocked(
  sourceControlOrgId: string,
): Promise<MacaroonOrgKeys> {
  // Re-read inside the lock so a racing caller's mint is visible.
  const row = await readOrg(sourceControlOrgId);
  if (
    row.macaroonOrgId &&
    row.macaroonOrgPubkey &&
    row.macaroonOrgPrivkey
  ) {
    return {
      sourceControlOrgId,
      macaroonOrgId: row.macaroonOrgId,
      macaroonOrgPubkey: row.macaroonOrgPubkey,
      created: false,
    };
  }

  if (!row.githubLogin) {
    throw new MacaroonOrgKeysError(
      `SourceControlOrg ${sourceControlOrgId} has no githubLogin; ` +
        `cannot derive macaroon org_id`,
    );
  }

  const macaroonOrgId = `${MACAROON_ORG_ID_PREFIX}${row.githubLogin}`;

  // Generate fresh secp256k1 keypair. `@noble/secp256k1` returns a
  // 32-byte privkey and a 33-byte compressed pubkey by default —
  // matches the on-disk format the Go plugin's `decodePubkey`
  // accepts (`gateway/internal/trust/types.go`).
  const privBytes = secp.utils.randomPrivateKey();
  const pubBytes = secp.getPublicKey(privBytes, /* isCompressed */ true);
  const macaroonOrgPubkey = bytesToHex(pubBytes);
  const macaroonOrgPrivkeyHex = bytesToHex(privBytes);

  const encryption = EncryptionService.getInstance();
  const encryptedPrivkey = JSON.stringify(
    encryption.encryptField("macaroonOrgPrivkey", macaroonOrgPrivkeyHex),
  );

  await db.sourceControlOrg.update({
    where: { id: sourceControlOrgId },
    data: {
      macaroonOrgId,
      macaroonOrgPubkey,
      macaroonOrgPrivkey: encryptedPrivkey,
    },
  });

  logger.info("Minted macaroon org keypair", MACAROON_ORG_LOG_TAG, {
    sourceControlOrgId,
    macaroonOrgId,
    // pubkey is safe to log; privkey is encrypted at rest and never
    // appears in logs.
    macaroonOrgPubkey,
  });

  return {
    sourceControlOrgId,
    macaroonOrgId,
    macaroonOrgPubkey,
    created: true,
  };
}

async function readOrg(sourceControlOrgId: string) {
  const row = await db.sourceControlOrg.findUnique({
    where: { id: sourceControlOrgId },
    select: {
      id: true,
      githubLogin: true,
      macaroonOrgId: true,
      macaroonOrgPubkey: true,
      macaroonOrgPrivkey: true,
    },
  });
  if (!row) {
    throw new MacaroonOrgKeysError(
      `SourceControlOrg ${sourceControlOrgId} not found`,
    );
  }
  return row;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
