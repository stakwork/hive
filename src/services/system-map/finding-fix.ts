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
 * `pull_request` card to the conversation.
 *
 * Tracking lives on the Finding node (`fix_*` properties, namespace
 * `infosec`): `fix_state=launching` marks a launch about to start (the
 * duplicate-launch guard; expires after `FIX_LAUNCH_STALE_MS`), then
 * `fix_conversation_id` + `fix_state=launched`. The status and PR are read
 * off the conversation's strut runs and rows — nothing is stored in Postgres.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/utils";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { FINDING_NAMESPACE, listFindings, parseFinding } from "@/lib/system-map/findings";
import { JOB_TURN_KIND } from "@/lib/strut-jobs";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";
import { validateUserBelongsToOrg } from "@/services/workspace";
import {
  buildFindingFixSeed,
  deriveFixStatus,
  extractPrUrl,
  FIX_CLEAR_MARK,
  getFixEligibility,
  isActiveFixStatus,
  isLaunching,
  launchedMark,
  launchingMark,
  planFixes,
  resolveFixRepository,
  validateFixBatch,
  type FixRefusal,
  type FixRunState,
} from "@/lib/system-map/finding-fix";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { SystemMapFinding, SystemMapFindingFix } from "@/types/system-map";

export class FindingFixError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const chatPathFor = (githubLogin: string | null, conversationId: string | null) =>
  githubLogin && conversationId ? `/org/${githubLogin}?chat=${conversationId}` : null;

/**
 * Each tracked finding's fix, its status and PR read from the conversation's
 * strut runs and rows. A fresh `launching` mark is QUEUED; an expired one is
 * not a fix at all.
 */
export async function deriveFixes(
  findings: SystemMapFinding[],
  githubLogin: string | null,
  now: number = Date.now(),
): Promise<SystemMapFindingFix[]> {
  const tracked = findings.filter((f) => f.fix && (f.fix.conversationId || isLaunching(f.fix, now)));
  const conversationIds = tracked.map((f) => f.fix!.conversationId).filter((id): id is string => !!id);

  const runsByConversation = new Map<string, FixRunState[]>();
  const prByConversation = new Map<string, string | null>();
  if (conversationIds.length > 0) {
    const runs = await db.strutRun.findMany({
      where: { conversationId: { in: conversationIds }, kind: { in: [ORCHESTRATOR_TURN_KIND, JOB_TURN_KIND] } },
      select: { conversationId: true, kind: true, status: true, error: true },
    });
    for (const run of runs) {
      if (!run.conversationId) continue;
      const list = runsByConversation.get(run.conversationId) ?? [];
      list.push({ kind: run.kind, status: run.status as FixRunState["status"], error: run.error });
      runsByConversation.set(run.conversationId, list);
    }
    // The PR is on the conversation's rows; read them only for fixes whose job has landed.
    const withLandedJob = conversationIds.filter((id) =>
      runsByConversation.get(id)?.some((r) => r.kind === JOB_TURN_KIND && r.status !== StrutRunStatus.PENDING),
    );
    if (withLandedJob.length > 0) {
      const conversations = await db.sharedConversation.findMany({
        where: { id: { in: withLandedJob } },
        select: { id: true, messages: true },
      });
      for (const c of conversations) prByConversation.set(c.id, extractPrUrl(c.messages));
    }
  }

  return tracked.map((finding) => {
    const tracking = finding.fix!;
    const conversationId = tracking.conversationId;
    const prUrl = conversationId ? (prByConversation.get(conversationId) ?? null) : null;
    const { status, error } = deriveFixStatus(
      conversationId ? (runsByConversation.get(conversationId) ?? []) : [],
      prUrl,
    );
    return {
      findingRefId: finding.refId,
      kind: tracking.kind ?? "",
      status,
      prUrl,
      error,
      chatPath: chatPathFor(githubLogin, conversationId),
      createdAt: tracking.startedAt ?? "",
    };
  });
}

async function githubLoginOf(workspaceId: string): Promise<string | null> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { sourceControlOrg: { select: { githubLogin: true } } },
  });
  return ws?.sourceControlOrg?.githubLogin ?? null;
}

/** The workspace's fixes (Finding nodes with tracking), for the Findings tab. */
export async function listFixes(workspaceId: string): Promise<SystemMapFindingFix[]> {
  const config = await getJarvisConfigForWorkspace(workspaceId);
  if (!config) return [];
  const listed = await listFindings(config);
  if (!listed.ok) throw new FindingFixError(listed.error, 502);
  return deriveFixes(listed.findings, await githubLoginOf(workspaceId));
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

  const requested = listed.findings.filter((f) => refIds.includes(f.refId));
  const current = await deriveFixes(requested, githubLogin);
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
  for (const { finding: listedFinding } of accepted) {
    const outcome = await startOne({
      config,
      listedFinding,
      repositories,
      orgId,
      githubLogin,
      input,
      publicBaseUrl,
    });
    if ("refusal" in outcome) refused.push({ refId: listedFinding.refId, reason: outcome.refusal });
    else started.push(outcome.fix);
  }
  return { started, refused };
}

/** Writes properties on the Finding node (namespace `infosec`); false on failure. */
async function writeMark(config: JarvisConnectionConfig, refId: string, properties: Record<string, unknown>) {
  const result = await updateNodeV2(config, refId, properties, FINDING_NAMESPACE);
  return result.success;
}

async function readFinding(config: JarvisConnectionConfig, refId: string): Promise<SystemMapFinding | null> {
  const node = await readNodeByRef(config, refId);
  if (!node.success) return null;
  return parseFinding({ ref_id: refId, node_type: node.node_type ?? "Finding", properties: node.properties ?? {} });
}

/**
 * One finding: re-read it, mark it `launching`, create the conversation and
 * launch the strut, then record the conversation. The mark is the
 * duplicate-launch guard (best effort — the graph has no compare-and-set, so
 * the mark is read back to confirm it is ours); every failure after it
 * clears the marks again.
 */
async function startOne(args: {
  config: JarvisConnectionConfig;
  listedFinding: SystemMapFinding;
  repositories: { repositoryUrl: string }[];
  orgId: string;
  githubLogin: string;
  input: StartFindingFixesInput;
  publicBaseUrl: string;
}): Promise<{ fix: SystemMapFindingFix } | { refusal: string }> {
  const { config, input } = args;
  const refId = args.listedFinding.refId;

  // Re-read: the list may be stale (a verdict changed, or another launch marked it).
  const finding = await readFinding(config, refId);
  if (!finding) return { refusal: "Finding not found" };
  const eligibility = getFixEligibility(finding);
  if (!eligibility.eligible) return { refusal: eligibility.reason };
  if (isLaunching(finding.fix)) return { refusal: "A fix for this finding is already in progress" };
  if (finding.fix?.conversationId) {
    const [existing] = await deriveFixes([finding], args.githubLogin);
    if (existing && isActiveFixStatus(existing.status)) {
      return { refusal: "A fix for this finding is already in progress" };
    }
  }
  const repo = resolveFixRepository(finding, args.repositories);
  if (!repo) return { refusal: "Could not determine which repository this finding belongs to" };

  const startedAt = new Date().toISOString();
  const mark = launchingMark({ kind: eligibility.kind, repo: repo.repositoryUrl, startedAt, startedBy: input.userId });
  if (!(await writeMark(config, refId, mark))) return { refusal: "Could not mark the finding as being fixed" };
  const confirmed = await readFinding(config, refId);
  if (confirmed?.fix?.startedAt !== startedAt || confirmed.fix.startedBy !== input.userId) {
    return { refusal: "A fix for this finding is already in progress" }; // another launch won the mark
  }

  const rollback = async (conversationId?: string) => {
    if (conversationId) await db.sharedConversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    await writeMark(config, refId, FIX_CLEAR_MARK);
  };

  let conversationId: string | undefined;
  try {
    const seed = buildFindingFixSeed(eligibility.kind, finding, input.workspaceSlug, repo.repositoryUrl);
    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: args.orgId,
        workspaceId: null,
        userId: input.userId,
        title: `Infosec fix: ${finding.title}`.slice(0, 100),
        messages: [{ id: `infosec-fix-${refId}`, role: "user", content: seed, timestamp: startedAt }],
        followUpQuestions: [],
        isShared: false,
        lastMessageAt: new Date(),
        source: "org-canvas",
        settings: {
          extraWorkspaceSlugs: [input.workspaceSlug],
          infosecFindingRefId: refId,
          infosecWorkspaceSlug: input.workspaceSlug,
        } as unknown as never,
      },
      select: { id: true },
    });
    conversationId = conversation.id;

    const launched = await launchOrchestratorTurn({
      userId: input.userId,
      orgId: args.orgId,
      conversationId,
      message: seed,
      publicBaseUrl: args.publicBaseUrl,
      timeZone: input.timeZone,
    });
    if (launched.status !== "started") {
      await rollback(conversationId);
      return { refusal: launched.status === "busy" ? launched.note : launched.error };
    }
  } catch (error) {
    console.error("[FindingFix] launch failed:", error);
    await rollback(conversationId);
    return { refusal: "The fix could not be started" };
  }

  // The strut is running: record the conversation. If this write fails the
  // `launching` mark stays (and blocks duplicates until it expires).
  if (!(await writeMark(config, refId, launchedMark(conversationId)))) {
    console.error("[FindingFix] could not record conversation on finding", refId);
  }
  return {
    fix: {
      findingRefId: refId,
      kind: eligibility.kind,
      status: "QUEUED",
      prUrl: null,
      error: null,
      chatPath: chatPathFor(args.githubLogin, conversationId),
      createdAt: startedAt,
    },
  };
}
