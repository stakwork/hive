/**
 * Backfill canonical `owner/repo` repoKeys for ErrorIssue + ErrorEvent rows.
 *
 * Root cause: historical ingest stored repoKey as either the Repository DB id
 * (on match) or a loosely-normalized raw string like `git@github.com:org/repo`
 * (on no-match). This script rewrites every row to the canonical lowercase
 * `owner/repo` form used by the updated `resolveRepoKey`.
 *
 * Collision handling: because of the unique constraint
 * `@@unique([workspaceId, repoKey, fingerprint])` on ErrorIssue, two issues
 * that map to the same canonical key are merged — the surviving issue (earliest
 * firstSeenAt) absorbs the other's occurrenceCount, lastSeenAt, and events,
 * then the duplicate is deleted.  All of this runs inside a Prisma transaction
 * per collision group so partial failures are safe.
 *
 * Idempotent: re-running after canonicalization is already applied is a no-op
 * (canonical keys match themselves, so no updates are issued).
 *
 * Usage:
 *   npx tsx scripts/backfill-error-repo-keys.ts
 *   npx tsx scripts/backfill-error-repo-keys.ts --batch=200
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-error-repo-keys.ts
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { canonicalRepoKey } from "../src/lib/utils/error-fingerprint";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

const BATCH_SIZE = 200;

function parseFlag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  const batchSize = parseFlag("batch") ? Number(parseFlag("batch")) : BATCH_SIZE;

  console.log(`[backfill-repo-keys] starting — batch size: ${batchSize}`);

  // ── 1. Load all repositories so we can resolve repositoryId → canonical key
  const allRepos = await prisma.repository.findMany({
    select: { id: true, name: true, repositoryUrl: true },
  });
  const repoById = new Map(
    allRepos.map((r) => [r.id, canonicalRepoKey(r.repositoryUrl || r.name)]),
  );

  // ── 2. Per-workspace counters
  const workspaceStats: Record<
    string,
    { scanned: number; rewritten: number; merged: number }
  > = {};

  function stats(workspaceId: string) {
    if (!workspaceStats[workspaceId]) {
      workspaceStats[workspaceId] = { scanned: 0, rewritten: 0, merged: 0 };
    }
    return workspaceStats[workspaceId];
  }

  // ── 3. Paginate through all ErrorIssue rows
  let cursor: string | undefined;
  let totalScanned = 0;
  let totalRewritten = 0;
  let totalMerged = 0;

  for (;;) {
    const issues = await prisma.errorIssue.findMany({
      take: batchSize,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        repositoryId: true,
        repoKey: true,
        fingerprint: true,
        occurrenceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });

    if (issues.length === 0) break;
    cursor = issues[issues.length - 1].id;
    totalScanned += issues.length;

    for (const issue of issues) {
      stats(issue.workspaceId).scanned++;

      // Compute canonical key — prefer resolved repo URL, fall back to stored repoKey
      const rawForCanon = issue.repositoryId
        ? (repoById.get(issue.repositoryId) ?? issue.repoKey)
        : issue.repoKey;
      const newKey = canonicalRepoKey(rawForCanon);

      if (newKey === issue.repoKey) {
        // Already canonical — skip
        continue;
      }

      // Check for a collision (another issue with same workspaceId+newKey+fingerprint)
      const collision = await prisma.errorIssue.findUnique({
        where: {
          workspaceId_repoKey_fingerprint: {
            workspaceId: issue.workspaceId,
            repoKey: newKey,
            fingerprint: issue.fingerprint,
          },
        },
        select: { id: true, occurrenceCount: true, firstSeenAt: true, lastSeenAt: true },
      });

      if (collision && collision.id !== issue.id) {
        // Merge: keep the earlier issue (by firstSeenAt), absorb the other
        const [survivor, duplicate] =
          collision.firstSeenAt <= issue.firstSeenAt
            ? [collision, issue]
            : [issue, collision];

        await prisma.$transaction(async (tx) => {
          // Re-point events from duplicate → survivor
          await tx.errorEvent.updateMany({
            where: { issueId: duplicate.id },
            data: { issueId: survivor.id, repoKey: newKey },
          });

          // Merge counters onto survivor
          await tx.errorIssue.update({
            where: { id: survivor.id },
            data: {
              repoKey: newKey,
              occurrenceCount: survivor.occurrenceCount + duplicate.occurrenceCount,
              firstSeenAt:
                survivor.firstSeenAt < duplicate.firstSeenAt
                  ? survivor.firstSeenAt
                  : duplicate.firstSeenAt,
              lastSeenAt:
                survivor.lastSeenAt > duplicate.lastSeenAt
                  ? survivor.lastSeenAt
                  : duplicate.lastSeenAt,
            },
          });

          // Delete duplicate
          await tx.errorIssue.delete({ where: { id: duplicate.id } });
        });

        stats(issue.workspaceId).merged++;
        stats(issue.workspaceId).rewritten++;
        totalMerged++;
        totalRewritten++;
        console.log(
          `[backfill-repo-keys] merged workspace=${issue.workspaceId} fingerprint=${issue.fingerprint} ` +
            `"${duplicate.id}" → "${survivor.id}" (newKey=${newKey})`,
        );
      } else {
        // No collision — simple update
        await prisma.errorIssue.update({
          where: { id: issue.id },
          data: { repoKey: newKey },
        });

        stats(issue.workspaceId).rewritten++;
        totalRewritten++;
      }
    }

    console.log(
      `[backfill-repo-keys] batch done — scanned so far: ${totalScanned}, rewritten: ${totalRewritten}, merged: ${totalMerged}`,
    );
  }

  // ── 4. Update ErrorEvent repoKeys (for events whose issue was not merged above)
  console.log("[backfill-repo-keys] updating ErrorEvent repoKeys...");
  let eventCursor: string | undefined;
  let totalEventRewritten = 0;

  for (;;) {
    const events = await prisma.errorEvent.findMany({
      take: batchSize,
      skip: eventCursor ? 1 : 0,
      ...(eventCursor ? { cursor: { id: eventCursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, repositoryId: true, repoKey: true },
    });

    if (events.length === 0) break;
    eventCursor = events[events.length - 1].id;

    for (const ev of events) {
      const rawForCanon = ev.repositoryId
        ? (repoById.get(ev.repositoryId) ?? ev.repoKey)
        : ev.repoKey;
      const newKey = canonicalRepoKey(rawForCanon);

      if (newKey !== ev.repoKey) {
        await prisma.errorEvent.update({
          where: { id: ev.id },
          data: { repoKey: newKey },
        });
        totalEventRewritten++;
      }
    }
  }

  // ── 5. Summary
  console.log("\n[backfill-repo-keys] ── Summary ──────────────────────────────");
  console.log(
    `[backfill-repo-keys] ErrorIssues — scanned: ${totalScanned}, rewritten: ${totalRewritten}, merged: ${totalMerged}`,
  );
  console.log(
    `[backfill-repo-keys] ErrorEvents — rewritten: ${totalEventRewritten}`,
  );

  for (const [wsId, s] of Object.entries(workspaceStats)) {
    if (s.rewritten > 0 || s.merged > 0) {
      console.log(
        `[backfill-repo-keys]   workspace=${wsId} scanned=${s.scanned} rewritten=${s.rewritten} merged=${s.merged}`,
      );
    }
  }

  console.log("[backfill-repo-keys] done.");
}

main()
  .catch((err) => {
    console.error("[backfill-repo-keys] fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
