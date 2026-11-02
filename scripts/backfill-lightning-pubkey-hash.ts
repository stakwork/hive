/**
 * One-off backfill: write `User.lightningPubkeyHash` for every user whose
 * Sphinx pubkey has none (`lib/auth/lightning-pubkey.ts`), so a lookup by
 * pubkey is one indexed read. Until it has run, a lookup still finds an
 * unhashed row by decrypting the unhashed rows (and hashes the one it finds).
 *
 * `--all` hashes every pubkey again: run it after a key rotation, since the
 * hash is keyed by the active encryption key.
 *
 * DRY-RUN BY DEFAULT: writes only when --apply is passed.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-lightning-pubkey-hash.ts [--all] [--apply]
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { backfillLightningPubkeyHashes } from "../src/lib/auth/lightning-pubkey";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  console.log(apply ? "APPLY mode: writes enabled" : "DRY RUN (default): no writes. Pass --apply to write.");
  console.log(all ? "Every pubkey (--all)" : "Pubkeys with no hash");

  const summary = await backfillLightningPubkeyHashes(prisma, { dryRun: !apply, all, log: (msg) => console.log(msg) });

  console.log("\nSummary:");
  console.log(`  scanned: ${summary.scanned}`);
  console.log(`  ${apply ? "hashed" : "would hash"}: ${summary.hashed}`);
  console.log(`  already current: ${summary.current}`);
  console.log(`  unreadable: ${summary.unreadable}`);
  console.log(`  conflicts (same pubkey as another user, left unhashed): ${summary.conflicts.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
