/**
 * One-off backfill: set SourceControlOrg.defaultWorkspaceId where it is NULL.
 *
 * Each such org gets its OLDEST eligible workspace. Eligible means:
 *   - Workspace.sourceControlOrgId = org.id
 *   - Workspace.deleted = false
 *   - the workspace has a swarm
 * Ordered by createdAt asc, then id asc. Orgs that already have a default are
 * never touched; orgs with no eligible workspace stay NULL; if the chosen
 * workspace is already another org's default, the org is skipped (conflict).
 *
 * DRY-RUN BY DEFAULT: writes only when --apply is passed.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-org-default-workspace.ts [--apply]
 *
 * Run the dry run first, review the output, and take a database backup before
 * running with --apply.
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { backfillOrgDefaultWorkspaces } from "../src/services/backfill-org-default-workspace";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode: writes enabled" : "DRY RUN (default): no writes. Pass --apply to write.");

  const summary = await backfillOrgDefaultWorkspaces(prisma, {
    dryRun: !apply,
    log: (msg) => console.log(msg),
  });

  console.log("\nSummary:");
  console.log(`  scanned (orgs with null default): ${summary.scanned}`);
  console.log(`  ${apply ? "updated" : "would update"}: ${apply ? summary.updated : summary.results.filter((r) => r.action === "would-update").length}`);
  console.log(`  skipped, no eligible workspace: ${summary.skippedNoEligible}`);
  console.log(`  skipped, conflict: ${summary.skippedConflict}`);
  console.log(`  skipped, already set: ${summary.skippedAlreadySet}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
