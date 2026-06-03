import { randomBytes } from "node:crypto";

import { bytesToHex, ed25519PublicKey, hexToBytes } from "gatekey";

import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { withLock } from "@/lib/locks/redis-lock";
import { logger } from "@/lib/logger";

import {
  BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_TRUST_LOCK_TTL_MS,
  MACAROON_USER_LOCK_PREFIX,
  MACAROON_USER_LOG_TAG,
} from "./constants";

/**
 * Phase-4 macaroon user keypair autogen.
 *
 * Every user signs their own `invocation` layer with an ed25519
 * key. Custodial in phase 1 — Hive holds the privkey encrypted at
 * rest. Phase 2+ moves the privkey off the platform (Yubikey /
 * Passkey / Sphinx app); the wire format and verifier are
 * unchanged, only the signer location differs.
 *
 * Triggered lazily from `mintInvocationMacaroon`. After the first
 * successful run for a user, every subsequent call is a fast DB
 * read + decrypt (no lock, no keygen).
 *
 * Per-user (not per-WorkspaceMember): the same human across all
 * workspaces of every org uses the same signing key. The macaroon's
 * `user_authorization.user_pubkey` field embeds this pubkey, and the
 * org's macaroon-signing key signs that envelope — i.e. the org
 * vouches for the user's binding. Permissions (which realms / agents
 * the user may act in) are computed per-mint from WorkspaceMember
 * rows; they are NOT stored on the keypair itself.
 *
 * Mirror in shape of `ensureMacaroonOrgKeys` (`macaroon-org-keys.ts`)
 * to keep the two custodial-keys code paths legible side by side.
 */

export interface MacaroonUserKeys {
  /**
   * `User.id` (the cuid). The lookup/lock key for this module. The
   * macaroon's `user_authorization.user_id` claim is a human-readable
   * derivative (`{login}-{userId}`) built in `mintInvocationMacaroon`
   * — don't conflate the two.
   */
  userId: string;
  /** Hex-encoded 32-byte ed25519 public key (64 hex chars). */
  userPubkey: string;
  /**
   * Decrypted 32-byte ed25519 seed/private key.
   *
   * **In-memory only.** Never log, never persist outside the
   * encrypted column on `users.macaroon_user_privkey`. Callers
   * (i.e. `mintInvocationMacaroon`) consume it immediately for one
   * signing op and drop the reference.
   */
  userPrivkey: Uint8Array;
  /** True iff the keypair was minted during this call (audit signal). */
  created: boolean;
}

export class MacaroonUserKeysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacaroonUserKeysError";
  }
}

/**
 * Look up (or generate) the macaroon keypair for a User.
 *
 * Idempotent under a per-user Redis lock — concurrent callers wait
 * for the first one to finish, then read the row. The lock is held
 * only across the keygen path; the fast path skips it entirely.
 *
 * @throws `MacaroonUserKeysError` if the user doesn't exist, or the
 *   stored privkey fails to decrypt (a misconfigured encryption key
 *   in the deployment — surfaced loudly rather than silently
 *   regenerating, because that would lock the user out of any
 *   already-issued macaroons).
 */
export async function ensureMacaroonUserKeys(
  userId: string,
): Promise<MacaroonUserKeys> {
  // Fast path: row already has both pubkey + privkey. Decrypt and
  // return. Avoids the lock on every hot-path mint.
  const cached = await readUser(userId);
  if (cached.macaroonUserPubkey && cached.macaroonUserPrivkey) {
    const privBytes = decryptPrivkey(userId, cached.macaroonUserPrivkey);
    return {
      userId,
      userPubkey: cached.macaroonUserPubkey,
      userPrivkey: privBytes,
      created: false,
    };
  }

  const lockKey = `${MACAROON_USER_LOCK_PREFIX}:${userId}`;
  return withLock(lockKey, () => mintLocked(userId), {
    ttlMs: BIFROST_TRUST_LOCK_TTL_MS,
    acquireTimeoutMs: BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS,
  });
}

async function mintLocked(userId: string): Promise<MacaroonUserKeys> {
  // Re-read inside the lock so a racing caller's mint is visible.
  const row = await readUser(userId);
  if (row.macaroonUserPubkey && row.macaroonUserPrivkey) {
    const privBytes = decryptPrivkey(userId, row.macaroonUserPrivkey);
    return {
      userId,
      userPubkey: row.macaroonUserPubkey,
      userPrivkey: privBytes,
      created: false,
    };
  }

  // Generate fresh ed25519 keypair. Any 32 random bytes is a valid
  // seed under RFC 8032 §5.1.5 — `ed25519PublicKey` (gatekey) derives
  // the matching public key. This matches `@noble/ed25519`'s default
  // and the wire format the Go verifier accepts.
  const privBytes = randomBytes(32);
  const pubBytes = ed25519PublicKey(privBytes);
  const userPubkey = bytesToHex(pubBytes);
  const userPrivkeyHex = bytesToHex(privBytes);

  const encryption = EncryptionService.getInstance();
  const encryptedPrivkey = JSON.stringify(
    encryption.encryptField("macaroonUserPrivkey", userPrivkeyHex),
  );

  await db.user.update({
    where: { id: userId },
    data: {
      macaroonUserPubkey: userPubkey,
      macaroonUserPrivkey: encryptedPrivkey,
    },
  });

  logger.info("Minted macaroon user keypair", MACAROON_USER_LOG_TAG, {
    userId,
    // pubkey is safe to log; privkey is encrypted at rest and never
    // appears in logs.
    userPubkey,
  });

  return {
    userId,
    userPubkey,
    userPrivkey: privBytes,
    created: true,
  };
}

async function readUser(userId: string) {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      macaroonUserPubkey: true,
      macaroonUserPrivkey: true,
    },
  });
  if (!row) {
    throw new MacaroonUserKeysError(`User ${userId} not found`);
  }
  return row;
}

function decryptPrivkey(userId: string, encrypted: string): Uint8Array {
  const encryption = EncryptionService.getInstance();
  let hex: string;
  try {
    hex = encryption.decryptField("macaroonUserPrivkey", encrypted);
  } catch (err) {
    // A decryption failure here is operational: the deployment's
    // encryption key changed or the stored value is corrupt. Either
    // way, regenerating would silently invalidate every macaroon
    // signed with the old key, so we surface the failure instead.
    throw new MacaroonUserKeysError(
      `Failed to decrypt macaroon privkey for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return hexToBytes(hex);
}
