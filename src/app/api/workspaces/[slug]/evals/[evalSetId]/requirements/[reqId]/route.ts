import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import {
  canWriteContested,
  coerce,
  findRequirement,
  hasContestedKey,
  resolveEvalSetScope,
} from "@/lib/evals/requirement-writes";
import { updateNode, deleteNode } from "@/services/swarm/api/nodes";

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

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId, reqId } = await params;

    const body = await request.json();
    const { name, description, prompt_snippet, desirable_cases, undesirable_cases } = body ?? {};

    // A requirement only needs a name and an optional reason (description).
    // prompt_snippet and example cases are optional and preserved if present.
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Tri-state: `undefined` means "leave the stored value alone". updateNode is
    // a partial merge, so coercing an omitted key to `false` here would make
    // every unrelated name/description edit clobber an agent-set `true`.
    let contested: boolean | undefined;
    if (hasContestedKey(body)) {
      const coerced = coerce(body.contested, "contested");
      if (!coerced.ok) {
        return NextResponse.json({ error: coerced.error }, { status: 400 });
      }
      contested = coerced.value;
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements PUT] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // Role gate applies ONLY when the body carries `contested`, so name /
    // description permissions stay exactly as they were for every existing user.
    if (contested !== undefined) {
      const access = await resolveWorkspaceAccess(request, { slug });
      const member = requireMemberAccess(access);
      if (member instanceof NextResponse) return member;
      if (!canWriteContested(member.role)) {
        console.warn(`[Evals Requirements PUT] contested write denied for role=${member.role}`);
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

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // Ownership: `reqId` is an opaque ref_id that updateNode would otherwise
    // write blind. Require it to hang off THIS eval set, in THIS workspace's
    // swarm, before touching it.
    const scope = await resolveEvalSetScope(config, evalSetId);
    if (!scope.ok) {
      console.warn(`[Evals Requirements PUT] Eval set not writable: ${scope.error}`);
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    if (!findRequirement(scope.requirements, reqId)) {
      console.warn(`[Evals Requirements PUT] Requirement not in eval set ${evalSetId}`);
      return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    }

    const result = await updateNode(config, {
      ref_id: reqId,
      node_type: "EvalRequirement",
      node_data: {
        name: name.trim(),
        description,
        prompt_snippet:
          typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
        desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
        undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
        ...(contested !== undefined ? { contested } : {}),
      },
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

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

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
