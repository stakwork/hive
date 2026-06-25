import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";

type RouteParams = {
  params: Promise<{ slug: string; promptId: string; versionId: string }>;
};

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * POST /api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals
 *
 * Dispatch a Stakwork eval set runner job against a prompt version.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, promptId, versionId } = await params;

    // IDOR guard — verify authenticated user has access to the workspace
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { workspaceId, swarmUrl, swarmSecretAlias } = swarmAccessResult.data;

    // Proxy to mock endpoint in mock mode
    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/prompts/${promptId}/versions/${versionId}/run-evals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await request.text(),
        },
      );
      return NextResponse.json(await mockResponse.json(), { status: mockResponse.status });
    }

    // Parse + validate body
    let body: { evalSetId?: string; promptName?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { evalSetId, promptName } = body;
    if (!evalSetId || !promptName) {
      return NextResponse.json(
        { error: "evalSetId and promptName are required" },
        { status: 400 },
      );
    }

    // Check required env var
    const workflowId = process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID;
    if (!workflowId) {
      return NextResponse.json(
        { error: "STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID is not configured" },
        { status: 400 },
      );
    }

    const promptVersionIdInt = parseInt(versionId, 10);
    if (isNaN(promptVersionIdInt)) {
      return NextResponse.json({ error: "Invalid versionId" }, { status: 400 });
    }

    const baseUrl =
      process.env.NEXTAUTH_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    // Create StakworkRun record
    const run = await db.stakworkRun.create({
      data: {
        type: "PROMPT_EVAL",
        workspaceId,
        promptVersionId: promptVersionIdInt,
        evalSetId,
        status: "PENDING",
        webhookUrl: `${baseUrl}/api/stakwork/webhook?run_id=placeholder`,
      },
    });

    // Update webhookUrl with real run id
    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        webhookUrl: `${baseUrl}/api/stakwork/webhook?run_id=${run.id}`,
      },
    });

    const stakworkPayload = {
      name: `hive-prompt-eval-${run.id}`,
      workflow_id: parseInt(workflowId, 10),
      webhook_url: `${baseUrl}/api/stakwork/webhook?run_id=${run.id}`,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              evalSetId,
              swarmUrl,
              swarmSecretAlias: swarmSecretAlias ?? "",
              prompt_overrides: [{ name: promptName, prompt_version_id: promptVersionIdInt }],
              webhookUrl: `${baseUrl}/api/webhook/stakwork/response?type=PROMPT_EVAL&workspace_id=${workspaceId}`,
            },
          },
        },
      },
    };

    // Call Stakwork
    const stakworkBaseUrl = optionalEnvVars.STAKWORK_BASE_URL;
    const stakworkApiKey = optionalEnvVars.STAKWORK_API_KEY;

    const stakworkResponse = await fetch(`${stakworkBaseUrl}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${stakworkApiKey}"`,
      },
      body: JSON.stringify(stakworkPayload),
    });

    if (!stakworkResponse.ok) {
      const errorText = await stakworkResponse.text().catch(() => "");
      console.error(`[run-evals] Stakwork returned ${stakworkResponse.status}: ${errorText}`);
      return NextResponse.json(
        { error: "Failed to dispatch eval job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkResponse.json();
    const projectId: number | undefined = stakworkData?.data?.project_id ?? stakworkData?.project_id;

    if (projectId) {
      await db.stakworkRun.update({
        where: { id: run.id },
        data: { projectId, status: "IN_PROGRESS" },
      });
    }

    return NextResponse.json({ success: true, runId: run.id, projectId: projectId ?? null });
  } catch (error) {
    console.error("[run-evals POST] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals
 *
 * Return the latest PROMPT_EVAL StakworkRun for this prompt version.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, promptId: _promptId, versionId } = await params;

    // IDOR guard — verify authenticated user has access to the workspace
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { workspaceId } = swarmAccessResult.data;

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/prompts/${_promptId}/versions/${versionId}/run-evals`,
        { headers: { "Content-Type": "application/json" } },
      );
      return NextResponse.json(await mockResponse.json(), { status: mockResponse.status });
    }

    const promptVersionIdInt = parseInt(versionId, 10);
    if (isNaN(promptVersionIdInt)) {
      return NextResponse.json({ error: "Invalid versionId" }, { status: 400 });
    }

    const runs = await db.stakworkRun.findMany({
      where: {
        type: "PROMPT_EVAL",
        promptVersionId: promptVersionIdInt,
        workspaceId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        result: true,
        evalSetId: true,
        promptVersionId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, data: runs[0] ?? null, history: runs });
  } catch (error) {
    console.error("[run-evals GET] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
