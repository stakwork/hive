/**
 * A person's Sphinx (Lightning) pubkey: `User.lightningPubkey`, encrypted,
 * and `User.lightningPubkeyHash`, what finds it — an HMAC-SHA256 of the
 * lower-case hex pubkey under the field-encryption key
 * (`EncryptionService.lookupHash`). The ciphertext has a fresh IV each write,
 * so the pubkey's own `@unique` says nothing and a lookup used to decrypt
 * row after row.
 *
 * Every write of the pubkey goes through `lightningPubkeyFields`, and a clear
 * clears both. Rows written before the hash existed are found by a decrypt
 * scan over the rows that have no hash yet, which writes the hash of the one
 * it finds; `backfillLightningPubkeyHashes` (`npm run
 * backfill:lightning-pubkey-hash`) hashes them all, after which the scan
 * reads nothing. The hash moves with the active key: after a key rotation,
 * run the backfill with `--all`.
 */

import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/** A Sphinx pubkey as Hive keys it: 33 bytes, lower-case hex. */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

/** The pubkey in the form the hash is taken of, or null when it is not one. */
export function normalizeLightningPubkey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const pubkey = raw.trim().toLowerCase();
  return PUBKEY_RE.test(pubkey) ? pubkey : null;
}

/** The lookup hash of a pubkey. */
export function lightningPubkeyHash(pubkey: string): string {
  return EncryptionService.getInstance().lookupHash("lightningPubkey", pubkey.trim().toLowerCase());
}

/** What a user row stores for a pubkey: the ciphertext (as the value was given) and its hash. */
export function lightningPubkeyFields(pubkey: string): { lightningPubkey: string; lightningPubkeyHash: string } {
  return {
    lightningPubkey: JSON.stringify(EncryptionService.getInstance().encryptField("lightningPubkey", pubkey)),
    lightningPubkeyHash: lightningPubkeyHash(pubkey),
  };
}

/** The pubkey a row holds, lower case, or null when it cannot be read (a failed decrypt hands back its input). */
function decryptedPubkey(stored: string): string | null {
  try {
    return normalizeLightningPubkey(EncryptionService.getInstance().decryptField("lightningPubkey", stored));
  } catch {
    return null;
  }
}

/** The user whose Sphinx pubkey this is, or null. One indexed read once the rows are hashed. */
export async function userByLightningPubkey(raw: string): Promise<{ id: string } | null> {
  const pubkey = normalizeLightningPubkey(raw);
  if (!pubkey) return null;
  const hash = lightningPubkeyHash(pubkey);
  const found = await db.user.findUnique({ where: { lightningPubkeyHash: hash }, select: { id: true } });
  if (found) return found;

  // A row from before the hash: read, and hashed so the next lookup is the index.
  const unhashed = await db.user.findMany({
    where: { lightningPubkey: { not: null }, lightningPubkeyHash: null },
    select: { id: true, lightningPubkey: true },
  });
  const match = unhashed.find((u) => u.lightningPubkey && decryptedPubkey(u.lightningPubkey) === pubkey);
  if (!match) return null;
  await db.user
    .updateMany({ where: { id: match.id, lightningPubkeyHash: null }, data: { lightningPubkeyHash: hash } })
    .catch((error) => logger.warn("Lightning pubkey hash not written", "SPHINX_AUTH", { userId: match.id, error }));
  return { id: match.id };
}

export interface BackfillLightningPubkeyHashSummary {
  scanned: number;
  hashed: number;
  /** Unchanged: the hash it holds is the one the key makes now. */
  current: number;
  /** A pubkey that could not be decrypted. */
  unreadable: number;
  /** A pubkey another user's row already holds the hash of: left without one. */
  conflicts: string[];
}

/**
 * Hash every pubkey with no hash (`all`: every pubkey, as after a key
 * rotation). Idempotent; dry-run unless `dryRun: false`.
 */
export async function backfillLightningPubkeyHashes(
  prisma: Pick<PrismaClient, "user">,
  opts: { dryRun: boolean; all?: boolean; log?: (msg: string) => void },
): Promise<BackfillLightningPubkeyHashSummary> {
  const log = opts.log ?? (() => undefined);
  const rows = await prisma.user.findMany({
    where: { lightningPubkey: { not: null }, ...(opts.all ? {} : { lightningPubkeyHash: null }) },
    select: { id: true, lightningPubkey: true, lightningPubkeyHash: true },
    orderBy: { createdAt: "asc" },
  });
  const summary: BackfillLightningPubkeyHashSummary = {
    scanned: rows.length,
    hashed: 0,
    current: 0,
    unreadable: 0,
    conflicts: [],
  };
  const taken = new Map<string, string>(); // hash → user id, this pass
  for (const row of rows) {
    const pubkey = row.lightningPubkey ? decryptedPubkey(row.lightningPubkey) : null;
    if (!pubkey) {
      summary.unreadable++;
      log(`  ${row.id}: pubkey could not be decrypted, left as it is`);
      continue;
    }
    const hash = lightningPubkeyHash(pubkey);
    if (row.lightningPubkeyHash === hash) {
      summary.current++;
      taken.set(hash, row.id);
      continue;
    }
    const holder =
      taken.get(hash) ??
      (await prisma.user.findUnique({ where: { lightningPubkeyHash: hash }, select: { id: true } }))?.id;
    if (holder && holder !== row.id) {
      summary.conflicts.push(row.id);
      log(`  ${row.id}: the same pubkey as ${holder}, left without a hash`);
      continue;
    }
    taken.set(hash, row.id);
    if (!opts.dryRun) await prisma.user.update({ where: { id: row.id }, data: { lightningPubkeyHash: hash } });
    summary.hashed++;
  }
  return summary;
}
