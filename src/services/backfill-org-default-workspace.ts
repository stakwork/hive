/**
 * Backfill service: set SourceControlOrg.defaultWorkspaceId for existing orgs
 * where it is null, using the org's OLDEST eligible workspace.
 *
 * Eligible workspace: sourceControlOrgId = org.id, deleted = false, has a swarm.
 * Order: createdAt asc, id asc (tie-break).
 *
 * Orgs that already have a default are never queried or touched. Writes are
 * guarded with `defaultWorkspaceId: null` so a concurrently-set default is never
 * overwritten. Idempotent — safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

export type BackfillOrgDefaultAction =
  | "would-update"
  | "updated"
  | "no-eligible-workspace"
  | "conflict"
  | "already-set";

export interface BackfillOrgDefaultResult {
  orgId: string;
  githubLogin: string;
  workspaceId: string | null;
  action: BackfillOrgDefaultAction;
}

export interface BackfillOrgDefaultSummary {
  scanned: number;
  updated: number;
  skippedNoEligible: number;
  skippedConflict: number;
  skippedAlreadySet: number;
  results: BackfillOrgDefaultResult[];
}

export async function backfillOrgDefaultWorkspaces(
  prisma: PrismaClient,
  opts: { dryRun: boolean; log?: (msg: string) => void },
): Promise<BackfillOrgDefaultSummary> {
  const log = opts.log ?? (() => {});

  const orgs = await prisma.sourceControlOrg.findMany({
    where: { defaultWorkspaceId: null },
    select: { id: true, githubLogin: true },
    orderBy: { id: "asc" },
  });

  const summary: BackfillOrgDefaultSummary = {
    scanned: orgs.length,
    updated: 0,
    skippedNoEligible: 0,
    skippedConflict: 0,
    skippedAlreadySet: 0,
    results: [],
  };

  const record = (
    org: { id: string; githubLogin: string },
    workspaceId: string | null,
    action: BackfillOrgDefaultAction,
  ) => {
    summary.results.push({ orgId: org.id, githubLogin: org.githubLogin, workspaceId, action });
    log(`[${action}] org=${org.githubLogin} (${org.id}) workspace=${workspaceId ?? "-"}`);
  };

  for (const org of orgs) {
    const ws = await prisma.workspace.findFirst({
      where: {
        sourceControlOrgId: org.id,
        deleted: false,
        swarm: { isNot: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, defaultForOrg: { select: { id: true } } },
    });

    if (!ws) {
      summary.skippedNoEligible++;
      record(org, null, "no-eligible-workspace");
      continue;
    }

    if (ws.defaultForOrg && ws.defaultForOrg.id !== org.id) {
      summary.skippedConflict++;
      record(org, ws.id, "conflict");
      continue;
    }

    if (opts.dryRun) {
      record(org, ws.id, "would-update");
      continue;
    }

    const { count } = await prisma.sourceControlOrg.updateMany({
      where: { id: org.id, defaultWorkspaceId: null },
      data: { defaultWorkspaceId: ws.id },
    });

    if (count === 0) {
      summary.skippedAlreadySet++;
      record(org, ws.id, "already-set");
      continue;
    }

    summary.updated++;
    record(org, ws.id, "updated");
  }

  return summary;
}
