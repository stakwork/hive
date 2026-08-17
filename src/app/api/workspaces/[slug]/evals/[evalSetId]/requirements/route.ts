import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import type { JarvisNode } from "@/types/jarvis";

/**
 * Coerce a loosely-typed value to a real JSON boolean, or return undefined
 * when the value is absent. Returns null for un-coercible values (caller
 * should 400).
 *
 * Accepts: true | false | 1 | 0 | "true" | "false" (case-insensitive).
 * Rejects: any other string, object, array, etc.
 */
export function coerceContested(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null; // un-coercible
}

type RouteParams = { params: Promise<{ slug: string; evalSetId: string }> };

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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements GET] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
        { method: "GET" },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals Requirements GET] Jarvis URL: ${jarvisUrl}`);

    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const url = `${jarvisUrl}/v2/nodes/${evalSetId}?expand=edges&edge_type=${edgeType}&depth=1`;

    const jarvisRes = await fetch(url, {
      headers: { "x-api-token": swarmApiKey },
    });

    if (!jarvisRes.ok) {
      const text = await jarvisRes.text().catch(() => "");
      console.error(`[Evals Requirements GET] Jarvis error ${jarvisRes.status}: ${text}`);
      return NextResponse.json(
        { error: "Failed to fetch requirements from Jarvis" },
        { status: 502 },
      );
    }

    const jarvisData = await jarvisRes.json();
    // The depth-1 expand returns the EvalSet root node alongside its requirement
    // neighbors, and Jarvis node types come back inconsistently cased
    // ("Evalset" / "Evalrequirement"). Keep only requirement nodes (matched
    // case-insensitively) and drop the root so the set isn't listed as a requirement.
    const nodes: JarvisNode[] = (jarvisData?.nodes ?? []).filter(
      (n: JarvisNode) =>
        n.ref_id !== evalSetId &&
        String(n.node_type ?? "").toLowerCase() === "evalrequirement",
    );
    const edges: Array<{ target_ref_id: string; properties?: { order?: number }; edge_data?: { order?: number } }> =
      jarvisData?.edges ?? [];

    // Merge edge order into each node's properties
    for (const node of nodes) {
      const edge = edges.find((e) => e.target_ref_id === node.ref_id);
      if (edge) {
        const order = edge.properties?.order ?? edge.edge_data?.order;
        if (order !== undefined) {
          node.properties = { ...node.properties, order };
        }
      }
    }

    return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
  } catch (error) {
    console.error("[Evals/Requirements] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements POST] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const body = await request.json();
    const { name, description, prompt_snippet, desirable_cases, undesirable_cases, order, contested } =
      body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Validate `contested` when present — before any auth/swarm work
    const contestedCoerced = coerceContested(contested);
    if (contestedCoerced === null) {
      return NextResponse.json(
        { error: "contested must be a boolean (true, false, 1, 0, \"true\", or \"false\")" },
        { status: 400 },
      );
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements POST] Swarm access denied: ${swarmAccessResult.error.type}`);
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
      // Owner is not in workspaceMember table but always has full rights.
      // If member is null the caller is the workspace owner (swarmAccess succeeded).
      const role = member?.role ?? "OWNER";
      if (!(CONTESTED_WRITE_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json(
          { error: "Insufficient permissions to set contested" },
          { status: 403 },
        );
      }
    }

    console.log(`[Evals Requirements POST] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements POST] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey, workspaceId } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };
    console.log(`[Evals Requirements POST] Jarvis URL: ${jarvisUrl}`);

    // IDOR: verify the evalSet belongs to this workspace before any write.
    // Fetch it via HAS_REQUIREMENT (same call used by GET, avoids an extra
    // round-trip) and assert ownership. Fail closed: any non-ok response from
    // Jarvis is treated as "cannot confirm ownership" → 404, not a pass-through.
    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const setCheckRes = await fetch(
      `${jarvisUrl}/v2/nodes/${encodeURIComponent(evalSetId)}?expand=edges&edge_type=${edgeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );
    if (!setCheckRes.ok) {
      console.warn(`[Evals Requirements POST] Could not verify eval set ownership: Jarvis ${setCheckRes.status}`);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const setData = await setCheckRes.json();
    const setNode = (setData?.nodes ?? []).find(
      (n: JarvisNode) => n.ref_id === evalSetId,
    );
    if (!setNode) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // If Jarvis carries the workspace property, assert it matches. If absent,
    // the HAS_REQUIREMENT expand already scopes to the swarm for this workspace
    // (the swarmApiKey is workspace-scoped), which is sufficient isolation.
    const ownerWorkspaceId =
      setNode.properties?.workspace_id ?? setNode.properties?.workspaceId;
    if (ownerWorkspaceId && ownerWorkspaceId !== workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const id = randomUUID();

    // Build node_data — omit `contested` key entirely when undefined so the
    // tri-state partial-merge semantics apply on Jarvis. Default to false on create.
    const nodeData: Record<string, unknown> = {
      id,
      name: name.trim(),
      description,
      prompt_snippet:
        typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
      desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
      undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
      contested: contestedCoerced ?? false,
    };

    const nodeResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: nodeData,
    });
    console.log(`[Evals Requirements POST] addNode result: success=${nodeResult.success}, ref_id=${nodeResult.ref_id ?? 'n/a'}, error=${nodeResult.error ?? 'none'}`);

    if (!nodeResult.success || !nodeResult.ref_id) {
      return NextResponse.json(
        { error: nodeResult.error ?? "Failed to create requirement node" },
        { status: 502 },
      );
    }

    const edgeOrder = typeof order === "number" ? order : 0;

    const edgeResult = await addEdge(config, {
      edge: { edge_type: "HAS_REQUIREMENT", edge_data: { order: edgeOrder } },
      source: { ref_id: evalSetId },
      target: { ref_id: nodeResult.ref_id },
    });
    console.log(`[Evals Requirements POST] addEdge result: success=${edgeResult.success}, error=${edgeResult.error ?? 'none'}`);

    if (!edgeResult.success) {
      console.warn(`[Evals Requirements POST] Failed to link requirement to eval set: ${edgeResult.error}`);
      return NextResponse.json(
        { error: edgeResult.error ?? "Failed to link requirement to eval set" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: { ref_id: nodeResult.ref_id } });
  } catch (error) {
    console.error("[Evals/Requirements] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
