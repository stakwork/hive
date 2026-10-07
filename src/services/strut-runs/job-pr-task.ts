import crypto from "crypto";
import { ArtifactType, ChatRole, ChatStatus, TaskSourceType, WorkflowStatus } from "@prisma/client";
import type { StrutRunRow } from "@/services/strut-runs";
import type { PullRequestContent } from "@/lib/chat";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const LOG_TAG = "JOB_PR_TASK";

interface EnsureJobPrTaskResult {
  taskId: string;
  artifactId: string;
}

export interface JobPullRequestContent {
  url: string;
  repo: string;
  number: number;
  title?: string;
  headBranch?: string;
}

interface WorkspaceRef {
  id: string;
  sourceControlOrgId: string | null;
  deleted: boolean;
}

interface RepositoryRef {
  id: string;
  workspaceId: string;
}

function repositoryUrlFor(repo: string): string {
  return repo.startsWith("https://github.com/") ? repo : `https://github.com/${repo}`;
}

function advisoryLockKey(prUrl: string): bigint {
  const hash = crypto.createHash("sha256").update(prUrl).digest();
  return hash.readBigInt64BE(0);
}

async function resolveWorkspace(workspaceId: string): Promise<WorkspaceRef | null> {
  return db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, sourceControlOrgId: true, deleted: true },
  });
}

async function resolveRepository(repoSlug: string, workspaceId: string): Promise<RepositoryRef | null> {
  const jobWorkspace = await resolveWorkspace(workspaceId);
  if (!jobWorkspace || jobWorkspace.deleted || !jobWorkspace.sourceControlOrgId) {
    return null;
  }

  const repoUrl = repositoryUrlFor(repoSlug);

  const preferred = await db.repository.findFirst({
    where: {
      repositoryUrl: repoUrl,
      workspaceId: jobWorkspace.id,
      workspace: { deleted: false },
    },
    select: { id: true, workspaceId: true },
  });
  if (preferred) return preferred;

  return db.repository.findFirst({
    where: {
      repositoryUrl: repoUrl,
      workspace: {
        sourceControlOrgId: jobWorkspace.sourceControlOrgId,
        deleted: false,
      },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, workspaceId: true },
  });
}

export async function ensureJobPrTask(row: StrutRunRow, pr: JobPullRequestContent): Promise<EnsureJobPrTaskResult | null> {
  try {
    if (!pr.url || !pr.repo) return null;

    const repository = await resolveRepository(pr.repo, row.workspaceId);
    if (!repository) return null;

    const lockKey = advisoryLockKey(pr.url);

    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const existing = await tx.artifact.findFirst({
        where: {
          type: ArtifactType.PULL_REQUEST,
          content: {
            path: ["url"],
            equals: pr.url,
          },
          message: {
            task: {
              workspaceId: repository.workspaceId,
              deleted: false,
            },
          },
        },
        select: {
          id: true,
          message: { select: { taskId: true } },
        },
      });

      if (existing?.id && existing.message?.taskId) {
        return { taskId: existing.message.taskId, artifactId: existing.id };
      }

      const taskTitle = `[Job] ${pr.title?.trim() || pr.url}`;

      const task = await tx.task.create({
        data: {
          title: taskTitle,
          workspaceId: repository.workspaceId,
          repositoryId: repository.id,
          createdById: row.userId,
          updatedById: row.userId,
          sourceType: TaskSourceType.SYSTEM,
          mode: "live",
          workflowStatus: WorkflowStatus.COMPLETED,
          stakworkProjectId: null,
          podId: null,
          featureId: null,
          branch: pr.headBranch ?? null,
        },
        select: { id: true },
      });

      const message = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          message: `[Job] Opened pull request: ${pr.url}`,
          artifacts: {
            create: {
              type: ArtifactType.PULL_REQUEST,
              content: {
                repo: pr.repo,
                url: pr.url,
                status: "IN_PROGRESS",
                jobId: row.jobId ?? undefined,
              } satisfies PullRequestContent,
            },
          },
        },
        select: {
          artifacts: {
            select: { id: true },
            where: { type: ArtifactType.PULL_REQUEST },
          },
        },
      });

      const artifactId = message.artifacts[0]?.id;
      if (!artifactId) {
        throw new Error("PR artifact missing after creation");
      }

      return { taskId: task.id, artifactId };
    });

    return result;
  } catch (error) {
    logger.warn("ensureJobPrTask failed", LOG_TAG, {
      runId: row.id,
      jobId: row.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
