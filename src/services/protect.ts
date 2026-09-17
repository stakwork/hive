import { db } from "@/lib/db";
import { config as envConfig } from "@/config/env";
import { stakworkService } from "@/lib/service-factory";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { getBaseUrl } from "@/lib/utils";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import {
  applyProtectReviewFindings,
  listProtectFindings,
  serializeFindingForWorkflow,
} from "@/lib/protect/findings";
import type { IncomingProtectFinding, ProtectReviewCounts } from "@/types/protect";
import type { ProtectReviewRun } from "@prisma/client";

const IN_FLIGHT_STATUSES = ["pending", "running"] as const;

export const PROTECT_ERRORS = {
  FEATURE_DISABLED: "Protect is not enabled",
  SECURITY_REVIEW_DISABLED: "Security review is not enabled for this workspace",
  RUN_IN_PROGRESS: "A Protect review is already in progress",
  RATE_LIMITED: "Too many Protect reviews. Try again later.",
  NO_REPOSITORIES: "Workspace has no repositories to scan",
  WORKFLOW_NOT_CONFIGURED: "STAKWORK_PROTECT_WORKFLOW_ID is required for Protect reviews",
  STAKWORK_NOT_CONFIGURED: "STAKWORK_API_KEY is required for Protect reviews",
  RUN_NOT_FOUND: "Protect review run not found",
  RUN_NOT_IN_FLIGHT: "Protect review run is not in progress",
  SWARM_NOT_CONFIGURED: "Workspace swarm is not configured",
} as const;

export function isProtectReviewInFlight(status: string): boolean {
  return (IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

export async function getInFlightProtectReviewRun(workspaceId: string) {
  return db.protectReviewRun.findFirst({
    where: {
      workspaceId,
      status: { in: [...IN_FLIGHT_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestCompletedFullProtectReviewRun(workspaceId: string) {
  return db.protectReviewRun.findFirst({
    where: {
      workspaceId,
      mode: "full",
      status: "completed",
    },
    orderBy: { completedAt: "desc" },
  });
}

export async function getLatestProtectReviewRun(workspaceId: string) {
  return db.protectReviewRun.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
}

export async function isSecurityReviewEnabled(workspaceId: string): Promise<boolean> {
  const config = await db.janitorConfig.findUnique({
    where: { workspaceId },
    select: { securityReviewEnabled: true },
  });
  return config?.securityReviewEnabled === true;
}

async function loadWorkspaceRepositories(workspaceId: string): Promise<string[]> {
  const repositories = await db.repository.findMany({
    where: { workspaceId },
    select: { repositoryUrl: true },
  });
  return repositories
    .map((repo) => repo.repositoryUrl)
    .filter((url): url is string => typeof url === "string" && url.trim() !== "");
}

async function dispatchProtectWorkflow(vars: Record<string, unknown>): Promise<number> {
  if (!envConfig.STAKWORK_API_KEY) {
    throw new Error(PROTECT_ERRORS.STAKWORK_NOT_CONFIGURED);
  }
  const workflowId = envConfig.STAKWORK_PROTECT_WORKFLOW_ID;
  if (!workflowId) {
    throw new Error(PROTECT_ERRORS.WORKFLOW_NOT_CONFIGURED);
  }

  const stakworkPayload = {
    name: `protect-${vars.mode}-${Date.now()}`,
    workflow_id: parseInt(workflowId, 10),
    workflow_params: {
      set_var: {
        attributes: {
          vars,
        },
      },
    },
  };

  const stakworkProject = await stakworkService().stakworkRequest("/projects", stakworkPayload);
  const projectId = (stakworkProject as { data?: { project_id?: number } })?.data?.project_id;
  if (!projectId) {
    throw new Error("No project ID returned from Stakwork");
  }
  return projectId;
}

export interface DispatchFullProtectReviewInput {
  workspaceId: string;
  workspaceSlug: string;
}

export async function dispatchFullProtectReview(
  input: DispatchFullProtectReviewInput,
): Promise<ProtectReviewRun> {
  const repositoryUrls = await loadWorkspaceRepositories(input.workspaceId);
  if (repositoryUrls.length === 0) {
    throw new Error(PROTECT_ERRORS.NO_REPOSITORIES);
  }

  const inFlight = await getInFlightProtectReviewRun(input.workspaceId);
  if (inFlight) {
    throw new Error(PROTECT_ERRORS.RUN_IN_PROGRESS);
  }

  const jarvisConfig = await getJarvisConfigForWorkspace(input.workspaceId);
  const priorFindings = jarvisConfig
    ? await listProtectFindings(jarvisConfig)
    : { ok: true as const, findings: [] };
  const priorNodes = priorFindings.ok
    ? priorFindings.findings.map(serializeFindingForWorkflow)
    : [];

  const run = await db.protectReviewRun.create({
    data: {
      workspaceId: input.workspaceId,
      mode: "full",
      status: "pending",
      repositoryUrl: null,
    },
  });

  const webhookUrl = `${getBaseUrl()}/api/protect/webhook`;

  try {
    const projectId = await dispatchProtectWorkflow({
      runId: run.id,
      mode: "full",
      webhookUrl,
      tokenReference: getStakworkTokenReference(),
      repositoryUrls,
      priorFindings: priorNodes,
    });

    const updated = await db.protectReviewRun.update({
      where: { id: run.id },
      data: {
        stakworkProjectId: projectId,
        status: "running",
      },
    });

    console.log(
      `[Protect] dispatch workspace=${input.workspaceSlug} mode=full runId=${run.id} repos=${repositoryUrls.length}`,
    );

    return updated;
  } catch (error) {
    await db.protectReviewRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export interface CompleteProtectReviewInput {
  runId: string;
  status: "completed" | "failed";
  findings?: IncomingProtectFinding[];
  error?: string;
}

export async function completeProtectReview(
  input: CompleteProtectReviewInput,
): Promise<{
  run: ProtectReviewRun;
  counts: ProtectReviewCounts;
  errors: string[];
}> {
  const run = await db.protectReviewRun.findUnique({
    where: { id: input.runId },
  });
  if (!run) {
    throw new Error(PROTECT_ERRORS.RUN_NOT_FOUND);
  }
  if (!isProtectReviewInFlight(run.status)) {
    throw new Error(PROTECT_ERRORS.RUN_NOT_IN_FLIGHT);
  }

  if (input.status === "failed") {
    const failed = await db.protectReviewRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date() },
    });
    console.log(
      `[Protect] completion workspace=${run.workspaceId} mode=${run.mode} runId=${run.id} status=failed`,
    );
    return {
      run: failed,
      counts: { created: 0, updated: 0, skipped: 0, stale: 0 },
      errors: input.error ? [input.error] : [],
    };
  }

  const jarvisConfig = await getJarvisConfigForWorkspace(run.workspaceId);
  if (!jarvisConfig) {
    const failed = await db.protectReviewRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date() },
    });
    return {
      run: failed,
      counts: { created: 0, updated: 0, skipped: 0, stale: 0 },
      errors: [PROTECT_ERRORS.SWARM_NOT_CONFIGURED],
    };
  }

  const applied = await applyProtectReviewFindings(jarvisConfig, input.findings ?? [], {
    mode: run.mode,
    repositoryUrl: run.repositoryUrl,
  });

  const completed = await db.protectReviewRun.update({
    where: { id: run.id },
    data: { status: "completed", completedAt: new Date() },
  });

  console.log(
    `[Protect] completion workspace=${run.workspaceId} mode=${run.mode} runId=${run.id} created=${applied.counts.created} updated=${applied.counts.updated} skipped=${applied.counts.skipped} stale=${applied.counts.stale}`,
  );

  return { run: completed, counts: applied.counts, errors: applied.errors };
}
