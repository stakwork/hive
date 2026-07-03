/**
 * Backfill `repositoryId` on ErrorIssue and ErrorEvent rows where it is NULL.
 *
 * Root cause: historical ingest failed to match the incoming `repository` string
 * (e.g. "stakwork/senza-lnd") against stored repository URLs like
 * "git@github.com:stakwork/senza-lnd" because `normalizeRepo` did not
 * canonicalize SSH vs HTTPS vs shorthand forms.  The `resolveRepoKey` fix
 * now uses `canonicalRepoKey` for matching, but rows already persisted still
 * have `repositoryId = NULL`.
 *
 * Strategy:
 *   For each ErrorIssue with `repositoryId IS NULL`, take the stored `repoKey`
 *   (a canonical `owner/repo` string since the previous backfill) and compare
 *   it against `canonicalRepoKey(repo.repositoryUrl)` / `canonicalRepoKey(repo.name)`
 *   for every Repository row in the same workspace.  Set `repositoryId` where
 *   a match is found.
 *
 *   Then apply the same logic to ErrorEvent rows that still have NULL
 *   `repositoryId` (re-resolving from the issue's resolved repositoryId when
 *   available, or falling back to the event's own `repoKey`).
 *
 * Idempotent: rows that already have a non-NULL `repositoryId` are skipped.
 * Safe to re-run against the full table.
 *
 * Usage:
 *   npx tsx scripts/backfill-repository-id.ts
 *   npx tsx scripts/backfill-repository-id.ts --batch=200
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-repository-id.ts
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { canonicalRepoKey } from "../src/lib/utils/error-fingerprint";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

const DEFAULT_BATCH_SIZE = 200;

function parseFlag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

/**
 * Build a lookup map: workspaceId → array of { id, canonicalUrl, canonicalName }
 * for all repositories in the system.
 */
async function buildRepoLookup(): Promise<
  Map<string, Array<{ id: string; canonicalUrl: string | null; canonicalName: string | null }>>
> {
  const allRepos = await prisma.repository.findMany({
    select: { id: true, name: true, repositoryUrl: true, workspaceId: true },
  });

  const map = new Map<
    string,
    Array<{ id: string; canonicalUrl: string | null; canonicalName: string | null }>
  >();

  for (const repo of allRepos) {
    const entry = {
      id: repo.id,
      canonicalUrl: repo.repositoryUrl ? canonicalRepoKey(repo.repositoryUrl) : null,
      canonicalName: repo.name ? canonicalRepoKey(repo.name) : null,
    };
    if (!map.has(repo.workspaceId)) map.set(repo.workspaceId, []);
    map.get(repo.workspaceId)!.push(entry);
  }

  return map;
}

/**
 * Given a canonical repo key (already in `owner/repo` form) and the list of
 * repositories for a workspace, return the matching repository id or null.
 */
function resolveRepositoryId(
  canonicalKey: string,
  workspaceRepos: Array<{ id: string; canonicalUrl: string | null; canonicalName: string | null }>,
): { id: string; method: "url" | "name" } | null {
  for (const repo of workspaceRepos) {
    if (repo.canonicalUrl === canonicalKey) return { id: repo.id, method: "url" };
    if (repo.canonicalName === canonicalKey) return { id: repo.id, method: "name" };
  }
  return null;
}

async function main() {
  const batchSize = parseFlag("batch") ? Number(parseFlag("batch")) : DEFAULT_BATCH_SIZE;

  console.log(`[backfill-repository-id] starting — batch size: ${batchSize}`);

  const repoLookup = await buildRepoLookup();
  const totalWorkspaces = repoLookup.size;
  console.log(`[backfill-repository-id] loaded repo data for ${totalWorkspaces} workspace(s)`);

  // ── Phase 1: ErrorIssue rows ──────────────────────────────────────────────

  let issueCursor: string | undefined;
  let issuesScanned = 0;
  let issuesUpdated = 0;
  let issuesUnresolved = 0;

  // Track resolved issue → repositoryId for use in Phase 2
  const resolvedIssueRepoMap = new Map<string, string>();

  console.log("[backfill-repository-id] Phase 1: scanning ErrorIssue rows with NULL repositoryId...");

  for (;;) {
    const issues = await prisma.errorIssue.findMany({
      take: batchSize,
      skip: issueCursor ? 1 : 0,
      ...(issueCursor ? { cursor: { id: issueCursor } } : {}),
      where: { repositoryId: null },
      orderBy: { id: "asc" },
      select: { id: true, workspaceId: true, repoKey: true },
    });

    if (issues.length === 0) break;
    issueCursor = issues[issues.length - 1].id;
    issuesScanned += issues.length;

    for (const issue of issues) {
      const workspaceRepos = repoLookup.get(issue.workspaceId) ?? [];
      const canonicalKey = canonicalRepoKey(issue.repoKey);
      const match = resolveRepositoryId(canonicalKey, workspaceRepos);

      if (match) {
        await prisma.errorIssue.update({
          where: { id: issue.id },
          data: { repositoryId: match.id },
        });
        resolvedIssueRepoMap.set(issue.id, match.id);
        issuesUpdated++;
        console.log(
          `[backfill-repository-id] issue updated — id=${issue.id} repoKey=${issue.repoKey} ` +
            `canonicalKey=${canonicalKey} repositoryId=${match.id} method=${match.method}`,
        );
      } else {
        issuesUnresolved++;
        console.warn(
          `[backfill-repository-id] issue unresolved — id=${issue.id} repoKey=${issue.repoKey} ` +
            `canonicalKey=${canonicalKey} workspaceId=${issue.workspaceId} ` +
            `(no matching repository found in workspace)`,
        );
      }
    }

    console.log(
      `[backfill-repository-id] Phase 1 batch done — scanned: ${issuesScanned}, updated: ${issuesUpdated}, unresolved: ${issuesUnresolved}`,
    );
  }

  // ── Phase 2: ErrorEvent rows ──────────────────────────────────────────────

  let eventCursor: string | undefined;
  let eventsScanned = 0;
  let eventsUpdated = 0;
  let eventsUnresolved = 0;

  console.log("[backfill-repository-id] Phase 2: scanning ErrorEvent rows with NULL repositoryId...");

  for (;;) {
    const events = await prisma.errorEvent.findMany({
      take: batchSize,
      skip: eventCursor ? 1 : 0,
      ...(eventCursor ? { cursor: { id: eventCursor } } : {}),
      where: { repositoryId: null },
      orderBy: { id: "asc" },
      select: { id: true, workspaceId: true, repoKey: true, issueId: true },
    });

    if (events.length === 0) break;
    eventCursor = events[events.length - 1].id;
    eventsScanned += events.length;

    for (const event of events) {
      // Prefer the repositoryId resolved for the parent issue in Phase 1
      const issueRepoId = resolvedIssueRepoMap.get(event.issueId);

      if (issueRepoId) {
        await prisma.errorEvent.update({
          where: { id: event.id },
          data: { repositoryId: issueRepoId },
        });
        eventsUpdated++;
        console.log(
          `[backfill-repository-id] event updated via issue — id=${event.id} repositoryId=${issueRepoId}`,
        );
        continue;
      }

      // Fall back to resolving from the event's own repoKey
      const workspaceRepos = repoLookup.get(event.workspaceId) ?? [];
      const canonicalKey = canonicalRepoKey(event.repoKey);
      const match = resolveRepositoryId(canonicalKey, workspaceRepos);

      if (match) {
        await prisma.errorEvent.update({
          where: { id: event.id },
          data: { repositoryId: match.id },
        });
        eventsUpdated++;
        console.log(
          `[backfill-repository-id] event updated via repoKey — id=${event.id} repoKey=${event.repoKey} ` +
            `repositoryId=${match.id} method=${match.method}`,
        );
      } else {
        eventsUnresolved++;
        console.warn(
          `[backfill-repository-id] event unresolved — id=${event.id} repoKey=${event.repoKey} ` +
            `canonicalKey=${canonicalKey} workspaceId=${event.workspaceId}`,
        );
      }
    }

    console.log(
      `[backfill-repository-id] Phase 2 batch done — scanned: ${eventsScanned}, updated: ${eventsUpdated}, unresolved: ${eventsUnresolved}`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n[backfill-repository-id] ── Summary ─────────────────────────────");
  console.log(
    `[backfill-repository-id] ErrorIssues  — scanned: ${issuesScanned}, updated: ${issuesUpdated}, unresolved: ${issuesUnresolved}`,
  );
  console.log(
    `[backfill-repository-id] ErrorEvents  — scanned: ${eventsScanned}, updated: ${eventsUpdated}, unresolved: ${eventsUnresolved}`,
  );
  console.log("[backfill-repository-id] done.");
}

main()
  .catch((err) => {
    console.error("[backfill-repository-id] fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
