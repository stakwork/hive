import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";

type RouteParams = {
  params: Promise<{ slug: string; id: string }>;
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
 * DELETE /api/workspaces/[slug]/legal/benchmarks/recursion/[id]
 * Remove a recursion enrollment. IDOR-guarded by workspaceId.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, id } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // IDOR guard — scope the lookup to this workspace so no cross-workspace
    // record can be read or confirmed to exist before the delete.
    const entry = await db.legalBenchmarkRecursion.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });

    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.legalBenchmarkRecursion.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[legal/benchmarks/recursion/[id] DELETE] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
