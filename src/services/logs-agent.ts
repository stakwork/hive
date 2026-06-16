import type { Prisma } from "@prisma/client";
import {
  getWorkspaceSwarmAccess,
  getSwarmAccessByWorkspaceId,
} from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { EncryptionService } from "@/lib/encryption";
import { generateSignedUrl } from "@/lib/signed-urls";
import { getBifrostForLLM } from "@/services/bifrost";

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 720; // 12 minutes max

export interface LogsAgentScope {
  featureIds?: string[];
  taskIds?: string[];
}

export interface RunLogsAgentParams {
  slug: string;
  userId: string;
  prompt: string;
  scope?: LogsAgentScope;
  sessionId?: string;
}

export interface RunLogsAgentResult {
  answer: string;
  sessionId: string;
}

export type RunLogsAgentError =
  | { type: "WORKSPACE_NOT_FOUND" }
  | { type: "ACCESS_DENIED" }
  | { type: "SWARM_NOT_ACTIVE" }
  | { type: "SWARM_NOT_CONFIGURED" }
  | { type: "SWARM_NAME_MISSING" }
  | { type: "AGENT_REQUEST_FAILED"; statusCode: number; message: string }
  | { type: "NO_REQUEST_ID" }
  | { type: "AGENT_FAILED"; message: string }
  | { type: "TIMEOUT" }
  | { type: "UNEXPECTED"; message: string };

export type RunLogsAgentOutcome =
  | { success: true; data: RunLogsAgentResult }
  | { success: false; error: RunLogsAgentError };

/**
 * Core Logs Agent service — resolves swarm access, builds a StakworkRun
 * snapshot with signed log URLs, routes through Bifrost, initiates the
 * /logs/agent swarm call, and polls /progress until completion.
 *
 * Shared by:
 *  - POST /api/workspaces/[slug]/logs-agent  (standalone Logs Chat UI)
 *  - `logs_agent` tool in askTools            (dashboard chat)
 */
export async function runLogsAgent(
  params: RunLogsAgentParams,
): Promise<RunLogsAgentOutcome> {
  const { slug, userId, prompt, scope, sessionId } = params;

  // Validate + normalize scope ids
  const rawFeatureIds = Array.isArray(scope?.featureIds)
    ? scope.featureIds.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  const rawTaskIds = Array.isArray(scope?.taskIds)
    ? scope.taskIds.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  const hasScope = rawFeatureIds.length > 0 || rawTaskIds.length > 0;

  // Verify workspace access (auth + membership)
  const accessResult = await getWorkspaceSwarmAccess(slug, userId);

  let swarmUrl: string;
  let swarmApiKey: string;
  let swarmName: string;
  let poolName: string;

  if (accessResult.success) {
    ({ swarmUrl, swarmApiKey, swarmName, poolName } = accessResult.data);
  } else if (accessResult.error.type === "SWARM_API_KEY_MISSING") {
    const ws = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true, stakworkApiKey: true },
    });
    if (!ws) {
      return { success: false, error: { type: "WORKSPACE_NOT_FOUND" } };
    }
    const fallback = await getSwarmAccessByWorkspaceId(ws.id);
    if (!fallback.success) {
      return { success: false, error: { type: "SWARM_NOT_ACTIVE" } };
    }
    ({ swarmUrl, swarmApiKey, swarmName, poolName } = fallback.data);
  } else {
    const { error } = accessResult;
    type KnownType =
      | "WORKSPACE_NOT_FOUND"
      | "ACCESS_DENIED"
      | "SWARM_NOT_ACTIVE"
      | "SWARM_NOT_CONFIGURED"
      | "SWARM_NAME_MISSING";
    const knownTypes: KnownType[] = [
      "WORKSPACE_NOT_FOUND",
      "ACCESS_DENIED",
      "SWARM_NOT_ACTIVE",
      "SWARM_NOT_CONFIGURED",
      "SWARM_NAME_MISSING",
    ];
    if (knownTypes.includes(error.type as KnownType)) {
      return { success: false, error: { type: error.type as KnownType } };
    }
    return {
      success: false,
      error: { type: "UNEXPECTED", message: `Swarm access error: ${error.type}` },
    };
  }

  // Normalize to :3355 base URL
  const baseUrl = swarmUrl.includes(":3355")
    ? swarmUrl
    : (() => {
        const urlObj = new URL(swarmUrl);
        return swarmUrl.includes("localhost")
          ? `http://localhost:3355`
          : `https://${urlObj.hostname}:3355`;
      })();

  // Query workspace for stakworkApiKey and StakworkRuns
  const workspaceRow = await db.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true, stakworkApiKey: true },
  });

  // Decrypt stakworkApiKey if present
  let decryptedStakworkApiKey: string | undefined;
  if (workspaceRow?.stakworkApiKey) {
    try {
      const encryptionService = EncryptionService.getInstance();
      decryptedStakworkApiKey = encryptionService.decryptField(
        "stakworkApiKey",
        workspaceRow.stakworkApiKey,
      );
    } catch {
      decryptedStakworkApiKey = undefined;
    }
  }

  // Build StakworkRun query scope
  let scopeWhere: Prisma.StakworkRunWhereInput = {};
  if (hasScope) {
    const orConds: Prisma.StakworkRunWhereInput[] = [];
    if (rawFeatureIds.length > 0) {
      orConds.push({ featureId: { in: rawFeatureIds } });
      orConds.push({ task: { featureId: { in: rawFeatureIds } } });
    }
    if (rawTaskIds.length > 0) {
      orConds.push({ taskId: { in: rawTaskIds } });
    }
    scopeWhere = { OR: orConds };
  }

  const rawRuns = workspaceRow
    ? await db.stakworkRun.findMany({
        where: {
          workspaceId: workspaceRow.id,
          projectId: { not: null },
          ...scopeWhere,
        },
        orderBy: { createdAt: "desc" },
        take: hasScope ? 100 : 25,
        select: {
          projectId: true,
          type: true,
          status: true,
          createdAt: true,
          featureId: true,
          taskId: true,
          feature: { select: { title: true } },
          agentLogs: {
            select: { id: true, agent: true },
          },
        },
      })
    : [];

  // Log scope resolution
  logger.info(
    "[LogsAgent] StakworkRun scope resolved",
    `workspace=${slug}`,
    {
      hasScope,
      requestedFeatureIds: rawFeatureIds,
      requestedTaskIds: rawTaskIds,
      matchedRunCount: rawRuns.length,
      matchedProjectIds: rawRuns.map((r) => r.projectId),
      matchedAgentLogCount: rawRuns.reduce((n, r) => n + r.agentLogs.length, 0),
      sample: rawRuns.slice(0, 5).map((r) => ({
        projectId: r.projectId,
        type: r.type,
        status: r.status,
        featureId: r.featureId,
        taskId: r.taskId,
        feature: r.feature?.title ?? null,
        agentLogIds: r.agentLogs.map((l) => l.id),
      })),
    },
  );

  const appBaseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const SIGNED_URL_EXPIRY_SECONDS = 3600;

  const stakworkRuns = rawRuns.map((run) => ({
    projectId: run.projectId as number,
    type: run.type,
    status: run.status,
    feature: run.feature?.title ?? null,
    createdAt: run.createdAt.toISOString(),
    agentLogs: run.agentLogs.map((log) => ({
      agent: log.agent,
      url: generateSignedUrl(
        appBaseUrl,
        `/api/agent-logs/${log.id}/content`,
        SIGNED_URL_EXPIRY_SECONDS,
      ),
    })),
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (swarmApiKey) {
    headers["x-api-token"] = swarmApiKey;
  }

  const bifrost = workspaceRow
    ? await getBifrostForLLM(
        {
          workspaceId: workspaceRow.id,
          workspaceSlug: slug,
          userId,
        },
        { agentName: "logs-agent" },
      )
    : undefined;

  const agentBody: Record<string, unknown> = {
    prompt: prompt.trim(),
    swarmName,
    poolName,
    sessionId: sessionId || undefined,
    sessionConfig: {
      truncateToolResults: false,
      maxToolResultLines: 200,
      maxToolResultChars: 2000,
    },
    workspaceSlug: slug,
  };
  if (stakworkRuns.length > 0) {
    agentBody.stakworkRuns = stakworkRuns;
    if (decryptedStakworkApiKey) {
      agentBody.stakworkApiKey = process.env.STAKWORK_API_KEY;
    }
  }
  if (bifrost) {
    agentBody.apiKey = bifrost.apiKey;
    agentBody.baseUrl = bifrost.baseUrl;
    agentBody.headers = bifrost.headers;
  }

  const skipPrintVal = process.env.SKIP_LOG_AGENT_PRINT_PROGRESS;
  const dontPrint = skipPrintVal === "true" || skipPrintVal === "1";
  if (!dontPrint) {
    agentBody.printAgentProgress = true;
  }

  // Initiate the logs agent call
  const agentResponse = await fetch(`${baseUrl}/logs/agent`, {
    method: "POST",
    headers,
    body: JSON.stringify(agentBody),
  });

  if (!agentResponse.ok) {
    const errorText = await agentResponse.text();
    logger.error(
      "[LogsAgent] Agent request failed",
      `status=${agentResponse.status}`,
      errorText,
    );
    return {
      success: false,
      error: {
        type: "AGENT_REQUEST_FAILED",
        statusCode: agentResponse.status,
        message: "Failed to send request to logs agent",
      },
    };
  }

  const agentData = await agentResponse.json();
  const requestId = agentData.request_id;

  if (!requestId) {
    return { success: false, error: { type: "NO_REQUEST_ID" } };
  }

  // Poll for result
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollHeaders: Record<string, string> = {};
    if (swarmApiKey) {
      pollHeaders["x-api-token"] = swarmApiKey;
    }

    const progressResponse = await fetch(
      `${baseUrl}/progress?request_id=${requestId}`,
      { headers: pollHeaders },
    );

    if (!progressResponse.ok) {
      logger.error(
        "[LogsAgent] Progress poll failed",
        `status=${progressResponse.status}`,
      );
      continue;
    }

    const progressData = await progressResponse.json();

    if (progressData.status === "completed") {
      const result = progressData.result;
      return {
        success: true,
        data: {
          answer: result.final_answer || result.content || "",
          sessionId: result.sessionId || sessionId || "",
        },
      };
    }

    if (progressData.status === "failed") {
      const errorMsg =
        progressData.error?.message || "Logs agent request failed";
      logger.error("[LogsAgent] Request failed", errorMsg);
      return { success: false, error: { type: "AGENT_FAILED", message: errorMsg } };
    }

    // status === "pending" — keep polling
  }

  // Timed out
  return { success: false, error: { type: "TIMEOUT" } };
}
