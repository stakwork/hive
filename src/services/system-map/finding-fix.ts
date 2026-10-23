/**
 * Automated fixes for Infosec findings. Each fix is a Stakwork coding-agent
 * workflow (`STAKWORK_FINDING_FIX_WORKFLOW_ID`) that opens a PR; the run is
 * tracked in `FindingFix` and updated by `/api/system-map/finding-fix/webhook`.
 * The status and PR link are mirrored onto the graph node (best effort).
 */

import type { FindingFix, FindingFixStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { config as envConfig } from "@/config/env";
import { stakworkService } from "@/lib/service-factory";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getBaseUrl } from "@/lib/utils";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings, FINDING_NAMESPACE } from "@/lib/system-map/findings";
import { updateNodeV2 } from "@/services/swarm/api/nodes";
import {
  buildFixPrompt,
  canTransition,
  isGithubPrUrl,
  mapWebhookStatus,
  planFixes,
  resolveFixRepository,
  validateFixBatch,
  ACTIVE_FIX_STATUSES,
  type FixRefusal,
} from "@/lib/system-map/finding-fix";
import type { SystemMapFindingFix } from "@/types/system-map";

export const FINDING_FIX_ERRORS = {
  STAKWORK_NOT_CONFIGURED: "STAKWORK_API_KEY is required for finding fixes",
  WORKFLOW_NOT_CONFIGURED: "STAKWORK_FINDING_FIX_WORKFLOW_ID is required for finding fixes",
  MISSING_GITHUB_CREDENTIALS: "GitHub credentials are required to open pull requests",
  GRAPH_UNAVAILABLE: "Workspace swarm is not configured",
} as const;

export class FindingFixError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function serializeFix(row: FindingFix): SystemMapFindingFix {
  return {
    id: row.id,
    findingRefId: row.findingRefId,
    kind: row.kind,
    status: row.status,
    prUrl: row.prUrl,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The latest fix per finding. */
export async function listLatestFixes(workspaceId: string): Promise<SystemMapFindingFix[]> {
  const rows = await db.findingFix.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 2000 });
  const seen = new Set<string>();
  const latest: SystemMapFindingFix[] = [];
  for (const row of rows) {
    if (seen.has(row.findingRefId)) continue;
    seen.add(row.findingRefId);
    latest.push(serializeFix(row));
  }
  return latest;
}

async function dispatchFixWorkflow(vars: Record<string, unknown>): Promise<number> {
  if (!envConfig.STAKWORK_API_KEY) throw new Error(FINDING_FIX_ERRORS.STAKWORK_NOT_CONFIGURED);
  const workflowId = envConfig.STAKWORK_FINDING_FIX_WORKFLOW_ID;
  if (!workflowId) throw new Error(FINDING_FIX_ERRORS.WORKFLOW_NOT_CONFIGURED);
  const project = await stakworkService().stakworkRequest("/projects", {
    name: `finding-fix-${vars.fixId}`,
    workflow_id: parseInt(workflowId, 10),
    workflow_params: { set_var: { attributes: { vars } } },
  });
  const projectId = (project as { data?: { project_id?: number } })?.data?.project_id;
  if (!projectId) throw new Error("No project ID returned from Stakwork");
  return projectId;
}

/** Mirrors the fix state onto the Finding node; never throws. */
async function syncGraph(workspaceId: string, refId: string, status: FindingFixStatus, prUrl: string | null) {
  try {
    const config = await getJarvisConfigForWorkspace(workspaceId);
    if (!config) return;
    await updateNodeV2(
      config,
      refId,
      { fix_status: status.toLowerCase(), ...(prUrl ? { fix_pr_url: prUrl } : {}) },
      FINDING_NAMESPACE,
    );
  } catch (error) {
    console.error("[FindingFix] graph sync failed:", error);
  }
}

export interface StartFindingFixesInput {
  workspaceId: string;
  workspaceSlug: string;
  userId: string;
  refIds: string[];
}

export interface StartFindingFixesResult {
  started: SystemMapFindingFix[];
  refused: FixRefusal[];
}

/**
 * Validates and dispatches fixes. Throws `FindingFixError` for a request that
 * is wholly invalid (bad batch size, no graph, no credentials); findings that
 * are individually ineligible come back in `refused`.
 */
export async function startFindingFixes(input: StartFindingFixesInput): Promise<StartFindingFixesResult> {
  const refIds = [...new Set(input.refIds)];
  const batchError = validateFixBatch(refIds);
  if (batchError) throw new FindingFixError(batchError, 400);

  const config = await getJarvisConfigForWorkspace(input.workspaceId);
  if (!config) throw new FindingFixError(FINDING_FIX_ERRORS.GRAPH_UNAVAILABLE, 400);
  const listed = await listFindings(config);
  if (!listed.ok) throw new FindingFixError(listed.error, 502);

  const active = await db.findingFix.findMany({
    where: { workspaceId: input.workspaceId, findingRefId: { in: refIds }, status: { in: [...ACTIVE_FIX_STATUSES] } },
    select: { findingRefId: true },
  });
  const { accepted, refused } = planFixes(
    refIds,
    new Map(listed.findings.map((f) => [f.refId, f])),
    new Set(active.map((a) => a.findingRefId)),
  );
  if (accepted.length === 0) return { started: [], refused };

  const repositories = await db.repository.findMany({
    where: { workspaceId: input.workspaceId },
    select: { repositoryUrl: true, branch: true },
  });
  const creds = await getGithubUsernameAndPAT(input.userId, input.workspaceSlug);
  if (!creds?.username || !creds.token) throw new FindingFixError(FINDING_FIX_ERRORS.MISSING_GITHUB_CREDENTIALS, 400);

  const webhookUrl = `${getBaseUrl()}/api/system-map/finding-fix/webhook`;
  const started: SystemMapFindingFix[] = [];
  for (const { finding, kind } of accepted) {
    const repo = resolveFixRepository(finding, repositories);
    if (!repo) {
      refused.push({ refId: finding.refId, reason: "Could not determine which repository this finding belongs to" });
      continue;
    }
    const row = await db.findingFix.create({
      data: {
        workspaceId: input.workspaceId,
        findingRefId: finding.refId,
        kind,
        repositoryUrl: repo.repositoryUrl,
        createdById: input.userId,
      },
    });
    try {
      const projectId = await dispatchFixWorkflow({
        fixId: row.id,
        kind,
        webhookUrl,
        tokenReference: getStakworkTokenReference(),
        username: creds.username,
        pat: creds.token,
        repositoryUrl: repo.repositoryUrl,
        baseBranch: repo.branch,
        prompt: buildFixPrompt(kind, finding),
        finding: {
          refId: finding.refId,
          title: finding.title,
          severity: finding.severity,
          cweId: finding.cweId,
          file: finding.file,
          line: finding.line,
          description: finding.description,
          properties: finding.properties,
        },
      });
      const updated = await db.findingFix.update({ where: { id: row.id }, data: { stakworkProjectId: projectId } });
      started.push(serializeFix(updated));
      await syncGraph(input.workspaceId, finding.refId, "QUEUED", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dispatch failed";
      console.error("[FindingFix] dispatch failed:", message);
      const failed = await db.findingFix.update({ where: { id: row.id }, data: { status: "FAILED", error: message } });
      refused.push({ refId: finding.refId, reason: failed.error ?? "Dispatch failed" });
    }
  }
  return { started, refused };
}

export interface FindingFixCallback {
  fixId: string;
  status?: string;
  prUrl?: string | null;
  error?: string | null;
}

/** Applies a webhook callback. Returns null when the fix is unknown. */
export async function applyFindingFixCallback(cb: FindingFixCallback): Promise<FindingFix | null> {
  const row = await db.findingFix.findUnique({ where: { id: cb.fixId } });
  if (!row) return null;
  const prUrl = cb.prUrl && isGithubPrUrl(cb.prUrl) ? cb.prUrl : null;
  const next = mapWebhookStatus(cb.status, prUrl);
  if (!next || !canTransition(row.status, next)) return row;
  const updated = await db.findingFix.update({
    where: { id: row.id },
    data: {
      status: next,
      ...(prUrl ? { prUrl } : {}),
      ...(next === "FAILED" ? { error: (cb.error || "The fix agent did not open a pull request").slice(0, 1000) } : {}),
    },
  });
  await syncGraph(row.workspaceId, row.findingRefId, next, updated.prUrl);
  return updated;
}
