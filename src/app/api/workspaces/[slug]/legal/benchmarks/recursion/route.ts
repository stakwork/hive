import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";

type RouteParams = {
  params: Promise<{ slug: string }>;
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

const TASK_SLUG_RE = /^[a-z0-9_\-\/]+$/i;

/**
 * POST /api/workspaces/[slug]/legal/benchmarks/recursion
 * Enroll a run in the recursion loop. Gated to `openlaw` only.
 * Body: { taskSlug: string, runId: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    const body = await request.json() as { taskSlug?: unknown; runId?: unknown };
    const { taskSlug, runId } = body;

    if (typeof taskSlug !== "string" || typeof runId !== "string") {
      return NextResponse.json({ error: "taskSlug and runId are required" }, { status: 400 });
    }

    // Step 1: Validate taskSlug pattern
    if (!TASK_SLUG_RE.test(taskSlug)) {
      return NextResponse.json({ error: "Invalid taskSlug" }, { status: 400 });
    }

    // Step 2: IDOR guard — ensure runId belongs to this workspace
    const sourceRun = await db.stakworkRun.findUnique({
      where: { id: runId, workspaceId },
      select: { id: true },
    });
    if (!sourceRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Step 3: Uniqueness check — one enrollment per task
    const existing = await db.legalBenchmarkRecursion.findUnique({
      where: { workspaceId_taskSlug: { workspaceId, taskSlug } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Already enrolled" }, { status: 409 });
    }

    // Step 4: Create the enrollment
    const entry = await db.legalBenchmarkRecursion.create({
      data: { workspaceId, taskSlug, runId },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error("[legal/benchmarks/recursion POST] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/recursion
 * List all recursion enrollments for the openlaw workspace.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    const entries = await db.legalBenchmarkRecursion.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error("[legal/benchmarks/recursion GET] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
