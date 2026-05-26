import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
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
const MAX_POLL_ATTEMPTS = 120; // 2 minutes max

/**
 * POST /api/workspaces/[slug]/logs-agent
 *
 * Proxies a prompt to the swarm's /logs/agent endpoint, polls for the result,
 * and returns the final answer. Used by the Logs Chat UI.
 *
 * Request body:
 *   - prompt: string (required)
 *   - sessionId: string (optional, for multi-turn)
 *   - scope: { featureIds?: string[]; taskIds?: string[] } (optional)
 *       When present, the StakworkRun/AgentLog snapshot forwarded to the
 *       swarm is narrowed to runs/logs attached to these features/tasks
 *       (plus tasks belonging to those features). Drives @feature / #task
 *       mentions in the LogsChat UI.
 *
 * Forwarded to /logs/agent endpoint:
 *   - prompt: string
 *   - swarmName: string
 *   - sessionId: string | undefined
 *   - model: "haiku"
 *   - stakworkApiKey: string (optional, decrypted from workspace)
 *   - stakworkRuns: StakworkRunSummary[] (last 25 runs, or scoped subset)
 *   - sessionConfig: { truncateToolResults, maxToolResultLines, maxToolResultChars }
 *
 * Response:
 *   - { answer: string, sessionId: string } on success
 *   - { error: string } on failure
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { prompt, sessionId, scope } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }

    // Validate + normalize scope. We accept arrays of opaque id strings
    // and discard anything that isn't a non-empty string. The Prisma `in`
    // filter below treats an empty array as "match nothing", so we drop
    // empty arrays entirely.
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
    const accessResult = await getWorkspaceSwarmAccess(
      slug,
      userOrResponse.id,
    );

    // If the only issue is a missing API key, fall back to the internal
    // helper which treats the key as optional (needed for local dev).
    let swarmUrl: string;
    let swarmApiKey: string;
    let swarmName: string;

    if (accessResult.success) {
      ({ swarmUrl, swarmApiKey, swarmName } = accessResult.data);
    } else if (accessResult.error.type === "SWARM_API_KEY_MISSING") {
      // Auth passed but no API key — look up workspace ID and use the
      // internal helper that allows an empty key.
      const ws = await db.workspace.findFirst({
        where: { slug, deleted: false },
        select: { id: true, stakworkApiKey: true },
      });
      if (!ws) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 },
        );
      }
      const fallback = await getSwarmAccessByWorkspaceId(ws.id);
      if (!fallback.success) {
        return NextResponse.json(
          { error: "Swarm not configured or not active" },
          { status: 400 },
        );
      }
      ({ swarmUrl, swarmApiKey, swarmName } = fallback.data);
    } else {
      const { error } = accessResult;
      const statusMap: Record<string, { msg: string; status: number }> = {
        WORKSPACE_NOT_FOUND: { msg: "Workspace not found", status: 404 },
        ACCESS_DENIED: { msg: "Access denied", status: 403 },
        SWARM_NOT_ACTIVE: {
          msg: "Swarm not configured or not active",
          status: 400,
        },
        SWARM_NOT_CONFIGURED: {
          msg: "Swarm not configured or not active",
          status: 400,
        },
        SWARM_NAME_MISSING: { msg: "Swarm name not found", status: 400 },
      };
      const mapped = statusMap[error.type] || {
        msg: "Swarm access error",
        status: 500,
      };
      return NextResponse.json(
        { error: mapped.msg },
        { status: mapped.status },
      );
    }

    // getSwarmAccessByWorkspaceId already returns the :3355 URL;
    // getWorkspaceSwarmAccess returns the raw URL, so normalize it.
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
        // Silently omit — do not crash the request
        decryptedStakworkApiKey = undefined;
      }
    }

    // Query StakworkRun summaries with non-null projectId. Default scope
    // is the last 25 across the workspace; when the caller passes a
    // `scope` object (from @feature / #task mentions in LogsChat) we
    // narrow to runs attached to those features/tasks. Verifying that the
    // mentioned ids actually belong to this workspace happens implicitly
    // via `workspaceId: workspaceRow.id` — a forged id from another
    // workspace simply matches nothing.
    //
    // We don't authorize the scope ids separately: the user already has
    // access to this workspace (verified above), and any feature/task
    // they cannot see in this workspace just produces zero rows. This is
    // safe because the only data leaked back would be "this id is/isn't
    // in your workspace", which is uninteresting.
    let scopeWhere: Prisma.StakworkRunWhereInput = {};
    if (hasScope) {
      const orConds: Prisma.StakworkRunWhereInput[] = [];
      if (rawFeatureIds.length > 0) {
        orConds.push({ featureId: { in: rawFeatureIds } });
        // Runs attached to tasks that live under the mentioned features
        orConds.push({
          task: { featureId: { in: rawFeatureIds } },
        });
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
          // When scoped, take more — the user is asking specifically about
          // these features/tasks and probably wants the full history.
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

    // Log scope resolution so we can verify mention-driven filtering in
    // production. Reports the requested scope, how many runs matched, and
    // which projectIds landed in the snapshot the swarm will see. Helpful
    // for debugging "the agent doesn't know about my feature" reports.
    logger.info(
      "[LogsAgent] StakworkRun scope resolved",
      `workspace=${slug}`,
      {
        hasScope,
        requestedFeatureIds: rawFeatureIds,
        requestedTaskIds: rawTaskIds,
        matchedRunCount: rawRuns.length,
        matchedProjectIds: rawRuns.map((r) => r.projectId),
        matchedAgentLogCount: rawRuns.reduce(
          (n, r) => n + r.agentLogs.length,
          0,
        ),
        // First few matches for a quick eyeball check (full list lives in
        // matchedProjectIds above)
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

    // Derive the app base URL for generating signed URLs
    const appBaseUrl =
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

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

    // Send prompt to logs agent
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (swarmApiKey) {
      headers["x-api-token"] = swarmApiKey;
    }

    // Master Bifrost reconciler — see `services/bifrost/orchestrator.ts`.
    // Routes LLM calls through this workspace's Bifrost when we have a
    // `(workspaceId, userId)` pair and the rollout flag is on; otherwise
    // returns undefined and we fall back to the swarm's default LLM key.
    //
    // `agentName: "logs-agent"` is what shows up as the `agent-name` dim
    // on the gateway's `logs.db`, driving cost-per-agent rollups.
    const bifrost = workspaceRow
      ? await getBifrostForLLM(
          {
            workspaceId: workspaceRow.id,
            workspaceSlug: slug,
            userId: userOrResponse.id,
          },
          { agentName: "logs-agent" },
        )
      : undefined;

    // FIXME update to use the decryptedStakworkApiKey if we update to use keys for workspace
    const agentBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      swarmName,
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
    // Bifrost routing — matches the `repo/agent` protocol wired in
    // `repoAgent` (`src/lib/ai/askTools.ts`). When provided, the swarm-
    // side `/logs/agent` uses `apiKey` as the LLM bearer token,
    // `baseUrl` as the fully-formed per-provider LLM URL, and forwards
    // `headers` (today: the `x-macaroon` minted by the orchestrator
    // for cost-per-agent observability) onto the outbound LLM call.
    // `headers` may be an empty map when the macaroon mint failed —
    // that's shadow-mode degraded state, the LLM call still runs.
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
      return NextResponse.json(
        { error: "Failed to send request to logs agent" },
        { status: 502 },
      );
    }

    const agentData = await agentResponse.json();
    const requestId = agentData.request_id;

    if (!requestId) {
      return NextResponse.json(
        { error: "No request_id returned from logs agent" },
        { status: 502 },
      );
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
        return NextResponse.json({
          answer: result.final_answer || result.content || "",
          sessionId: result.sessionId || sessionId || "",
        });
      }

      if (progressData.status === "failed") {
        const errorMsg =
          progressData.error?.message || "Logs agent request failed";
        logger.error("[LogsAgent] Request failed", errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 502 });
      }

      // status === "pending" — keep polling
    }

    // Timed out
    return NextResponse.json(
      { error: "Request timed out waiting for logs agent response" },
      { status: 504 },
    );
  } catch (error) {
    logger.error("[LogsAgent] Unexpected error", String(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
