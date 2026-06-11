import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";

type RouteParams = { params: Promise<{ slug: string }> };

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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;
    const { searchParams } = request.nextUrl;

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { workspaceId } = swarmAccessResult.data;

    const q = searchParams.get("q")?.trim();
    const nameFilter =
      q && q.length >= 2 ? { contains: q, mode: "insensitive" as const } : undefined;

    const [tasks, features] = await Promise.all([
      db.task.findMany({
        where: {
          workspaceId,
          deleted: false,
          ...(nameFilter ? { title: nameFilter } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          featureId: true,
          feature: { select: { title: true } },
        },
      }),
      db.feature.findMany({
        where: {
          workspaceId,
          deleted: false,
          ...(nameFilter ? { title: nameFilter } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, title: true },
      }),
    ]);

    const withLogs = await Promise.all([
      ...tasks.map(async (t) => {
        const log = await db.agentLog.findFirst({
          where: { taskId: t.id },
          orderBy: { createdAt: "desc" },
          select: { agent: true, createdAt: true },
        });
        return {
          id: t.id,
          type: "task" as const,
          title: t.title,
          featureTitle: t.feature?.title ?? null,
          latestAgent: log?.agent ?? null,
          latestDate: log?.createdAt ?? null,
        };
      }),
      ...features.map(async (f) => {
        const log = await db.agentLog.findFirst({
          where: { featureId: f.id },
          orderBy: { createdAt: "desc" },
          select: { agent: true, createdAt: true },
        });
        return {
          id: f.id,
          type: "feature" as const,
          title: f.title,
          featureTitle: null,
          latestAgent: log?.agent ?? null,
          latestDate: log?.createdAt ?? null,
        };
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: { items: withLogs, total: withLogs.length },
    });
  } catch (error) {
    console.error("[Evals/Sessions] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
