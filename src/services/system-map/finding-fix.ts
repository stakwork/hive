/**
 * Automated fixes for Infosec findings — the Protect "Jamie" mechanism, run
 * for the user:
 *   1. an org-canvas `SharedConversation` seeded with the finding (as
 *      `protect/findings/[refId]/chat` does for Jamie), then
 *   2. `launchOrchestratorTurn` — the call `/api/ask/quick` makes for a chat
 *      with the "Strut orchestrator" switch on — which launches strut's
 *      `orchestrator` workflow; the orchestrator starts a `job` that opens
 *      the PR.
 * Nothing new comes back: the orchestrator turn and the job settle through
 * `/api/strut-runs/webhook`, which appends the job's row and its
 * `pull_request` card to the conversation. `FindingFix` only links finding →
 * conversation; the status and PR are read off those strut runs and rows.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/utils";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings } from "@/lib/system-map/findings";
import { JOB_TURN_KIND } from "@/lib/strut-jobs";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { validateUserBelongsToOrg } from "@/services/workspace";
import {
  buildFindingFixSeed,
  deriveFixStatus,
  extractPrUrl,
  isActiveFixStatus,
  planFixes,
  resolveFixRepository,
  validateFixBatch,
  type FixRefusal,
  type FixRunState,
} from "@/lib/system-map/finding-fix";
import type { SystemMapFindingFix } from "@/types/system-map";

const LIST_LIMIT = 2000;

export class FindingFixError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface FixRow {
  id: string;
  findingRefId: string;
  kind: string;
  conversationId: string;
  createdAt: Date;
}

/** The latest fix per finding, each with its status and PR read from strut's runs. */
export async function listLatestFixes(workspaceId: string, refIds?: string[]): Promise<SystemMapFindingFix[]> {
  const rows: FixRow[] = await db.findingFix.findMany({
    where: { workspaceId, ...(refIds ? { findingRefId: { in: refIds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  const seen = new Set<string>();
  const latest = rows.filter((row) => !seen.has(row.findingRefId) && !!seen.add(row.findingRefId));
  if (latest.length === 0) return [];

  const conversationIds = latest.map((r) => r.conversationId);
  const [runs, workspace] = await Promise.all([
    db.strutRun.findMany({
      where: { conversationId: { in: conversationIds }, kind: { in: [ORCHESTRATOR_TURN_KIND, JOB_TURN_KIND] } },
      select: { conversationId: true, kind: true, status: true, error: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    }),
  ]);
  const runsByConversation = new Map<string, FixRunState[]>();
  for (const run of runs) {
    if (!run.conversationId) continue;
    const list = runsByConversation.get(run.conversationId) ?? [];
    list.push({ kind: run.kind, status: run.status as FixRunState["status"], error: run.error });
    runsByConversation.set(run.conversationId, list);
  }

  // The PR is on the conversation's rows; read them only for fixes whose job has landed.
  const withLandedJob = latest
    .filter((r) =>
      runsByConversation
        .get(r.conversationId)
        ?.some((x) => x.kind === JOB_TURN_KIND && x.status !== StrutRunStatus.PENDING),
    )
    .map((r) => r.conversationId);
  const prByConversation = new Map<string, string | null>();
  if (withLandedJob.length > 0) {
    const conversations = await db.sharedConversation.findMany({
      where: { id: { in: withLandedJob } },
      select: { id: true, messages: true },
    });
    for (const c of conversations) prByConversation.set(c.id, extractPrUrl(c.messages));
  }

  const githubLogin = workspace?.sourceControlOrg?.githubLogin ?? null;
  return latest.map((row) => {
    const prUrl = prByConversation.get(row.conversationId) ?? null;
    const { status, error } = deriveFixStatus(runsByConversation.get(row.conversationId) ?? [], prUrl);
    return {
      id: row.id,
      findingRefId: row.findingRefId,
      kind: row.kind,
      status,
      prUrl,
      error,
      chatPath: githubLogin ? `/org/${githubLogin}?chat=${row.conversationId}` : null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export interface StartFindingFixesInput {
  workspaceId: string;
  workspaceSlug: string;
  userId: string;
  refIds: string[];
  /** Swarm-reachable base URL of this hive (strut's callback host). */
  publicBaseUrl?: string;
  timeZone?: string;
}

export interface StartFindingFixesResult {
  started: SystemMapFindingFix[];
  refused: FixRefusal[];
}

/**
 * Validates and starts fixes. Throws `FindingFixError` for a request that is
 * wholly invalid (bad batch size, no graph, workspace not in an org the user
 * belongs to); findings that are individually ineligible, already being
 * fixed, or whose launch strut refused come back in `refused`.
 */
export async function startFindingFixes(input: StartFindingFixesInput): Promise<StartFindingFixesResult> {
  const refIds = [...new Set(input.refIds)];
  const batchError = validateFixBatch(refIds);
  if (batchError) throw new FindingFixError(batchError, 400);

  const config = await getJarvisConfigForWorkspace(input.workspaceId);
  if (!config) throw new FindingFixError("Workspace swarm is not configured", 400);
  const listed = await listFindings(config);
  if (!listed.ok) throw new FindingFixError(listed.error, 502);

  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { sourceControlOrgId: true, sourceControlOrg: { select: { githubLogin: true } } },
  });
  const orgId = workspace?.sourceControlOrgId ?? null;
  const githubLogin = workspace?.sourceControlOrg?.githubLogin ?? null;
  if (!orgId || !githubLogin) throw new FindingFixError("This workspace is not linked to an organization", 400);
  if (!(await validateUserBelongsToOrg(githubLogin, input.userId))) {
    throw new FindingFixError("You must be a member of this organization to start a fix", 403);
  }

  const current = await listLatestFixes(input.workspaceId, refIds);
  const { accepted, refused } = planFixes(
    refIds,
    new Map(listed.findings.map((f) => [f.refId, f])),
    new Set(current.filter((f) => isActiveFixStatus(f.status)).map((f) => f.findingRefId)),
  );
  if (accepted.length === 0) return { started: [], refused };

  const repositories = await db.repository.findMany({
    where: { workspaceId: input.workspaceId },
    select: { repositoryUrl: true },
  });
  const publicBaseUrl = input.publicBaseUrl ?? getBaseUrl(null);

  const started: SystemMapFindingFix[] = [];
  for (const { finding, kind } of accepted) {
    const repo = resolveFixRepository(finding, repositories);
    if (!repo) {
      refused.push({ refId: finding.refId, reason: "Could not determine which repository this finding belongs to" });
      continue;
    }
    const seed = buildFindingFixSeed(kind, finding, input.workspaceSlug, repo.repositoryUrl);
    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: orgId,
        workspaceId: null,
        userId: input.userId,
        title: `Infosec fix: ${finding.title}`.slice(0, 100),
        messages: [
          { id: `infosec-fix-${finding.refId}`, role: "user", content: seed, timestamp: new Date().toISOString() },
        ],
        followUpQuestions: [],
        isShared: false,
        lastMessageAt: new Date(),
        source: "org-canvas",
        settings: {
          extraWorkspaceSlugs: [input.workspaceSlug],
          infosecFindingRefId: finding.refId,
          infosecWorkspaceSlug: input.workspaceSlug,
        } as unknown as never,
      },
      select: { id: true },
    });

    const launched = await launchOrchestratorTurn({
      userId: input.userId,
      orgId,
      conversationId: conversation.id,
      message: seed,
      publicBaseUrl,
      timeZone: input.timeZone,
    });
    if (launched.status !== "started") {
      await db.sharedConversation.delete({ where: { id: conversation.id } }).catch(() => undefined);
      refused.push({ refId: finding.refId, reason: launched.status === "busy" ? launched.note : launched.error });
      continue;
    }

    const row = await db.findingFix.create({
      data: {
        workspaceId: input.workspaceId,
        findingRefId: finding.refId,
        kind,
        repositoryUrl: repo.repositoryUrl,
        conversationId: conversation.id,
        createdById: input.userId,
      },
    });
    started.push({
      id: row.id,
      findingRefId: row.findingRefId,
      kind: row.kind,
      status: "QUEUED",
      prUrl: null,
      error: null,
      chatPath: `/org/${githubLogin}?chat=${conversation.id}`,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return { started, refused };
}
