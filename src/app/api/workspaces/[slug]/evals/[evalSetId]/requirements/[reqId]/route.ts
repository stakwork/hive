import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { updateNode, deleteNode } from "@/services/swarm/api/nodes";
import { coerceContested } from "../route";
import type { JarvisNode } from "@/types/jarvis";

type RouteParams = {
  params: Promise<{ slug: string; evalSetId: string; reqId: string }>;
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

// Roles allowed to set the `contested` flag (mirrors canReadRunReport)
const CONTESTED_WRITE_ROLES = ["OWNER", "ADMIN", "PM", "DEVELOPER"] as const;

/**
 * Fetch the eval set from Jarvis (HAS_REQUIREMENT expand) and verify:
 *   1. The fetch succeeded — fail closed, never skip on error.
 *   2. The set node exists in the response.
 *   3. If the set carries a workspaceId property, it matches the caller's workspace.
 *   4. The reqId (when provided) appears as an EvalRequirement child of the set.
 *
 * Returns the req node (for caller use) or a NextResponse to short-circuit.
 */
async function verifyEvalSetOwnership(
  jarvisUrl: string,
  swarmApiKey: string,
  evalSetId: string,
  workspaceId: string,
  reqId?: string,
): Promise<{ reqNode?: JarvisNode } | NextResponse> {
  const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
  let setCheckRes: Response;
  try {
    setCheckRes = await fetch(
      `${jarvisUrl}/v2/nodes/${encodeURIComponent(evalSetId)}?expand=edges&edge_type=${edgeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!setCheckRes.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const setData = await setCheckRes.json();
  const setNode = (setData?.nodes ?? []).find(
    (n: JarvisNode) => n.ref_id === evalSetId,
  );
  if (!setNode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownerWorkspaceId =
    setNode.properties?.workspace_id ?? setNode.properties?.workspaceId;
  if (ownerWorkspaceId && ownerWorkspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (reqId !== undefined) {
    const reqNodes: JarvisNode[] = (setData?.nodes ?? []).filter(
      (n: JarvisNode) =>
        n.ref_id !== evalSetId &&
        String(n.node_type ?? "").toLowerCase() === "evalrequirement",
    );
    const reqNode = reqNodes.find((n) => n.ref_id === reqId);
    if (!reqNode) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return { reqNode };
  }

  return {};
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId } = await params;

    const body = await request.json();
    const { name, description, prompt_snippet, desirable_cases, undesirable_cases, contested } =
      body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const contestedCoerced = coerceContested(contested);
    if (contestedCoerced === null) {
      return NextResponse.json(
        { error: "contested must be a boolean (true, false, 1, 0, \"true\", or \"false\")" },
        { status: 400 },
      );
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements PUT] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // Role gate: only DEVELOPER+ may set the `contested` field
    if (contestedCoerced !== undefined) {
      const { db } = await import("@/lib/db");
      const member = await db.workspaceMember.findFirst({
        where: {
          workspaceId: swarmAccessResult.data.workspaceId,
          userId: userOrResponse.id,
          leftAt: null,
        },
        select: { role: true },
      });
      const role = member?.role ?? "OWNER";
      if (!(CONTESTED_WRITE_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json(
          { error: "Insufficient permissions to set contested" },
          { status: 403 },
        );
      }
    }

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey, workspaceId } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // IDOR: verify reqId is reachable from evalSetId and that the set belongs
    // to this workspace — fail closed on any Jarvis error.
    const ownershipResult = await verifyEvalSetOwnership(
      jarvisUrl, swarmApiKey, evalSetId, workspaceId, reqId,
    );
    if (ownershipResult instanceof NextResponse) return ownershipResult;

    const nodeData: Record<string, unknown> = {
      name: name.trim(),
      description,
      prompt_snippet:
        typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
      desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
      undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
    };
    if (contestedCoerced !== undefined) {
      nodeData.contested = contestedCoerced;
    }

    const result = await updateNode(config, {
      ref_id: reqId,
      node_type: "EvalRequirement",
      node_data: nodeData,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Evals/Requirements] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId } = await params;

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements DELETE] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements/${reqId}`,
        { method: "DELETE" },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey, workspaceId } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // IDOR: verify reqId belongs to this eval set and workspace before deleting.
    const ownershipResult = await verifyEvalSetOwnership(
      jarvisUrl, swarmApiKey, evalSetId, workspaceId, reqId,
    );
    if (ownershipResult instanceof NextResponse) return ownershipResult;

    const result = await deleteNode(config, reqId);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Evals/Requirements] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
