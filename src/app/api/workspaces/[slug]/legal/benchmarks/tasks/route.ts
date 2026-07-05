import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { HARVEY_LAB_TASKS, HARVEY_LAB_TOTAL } from "@/lib/harvey-lab-tasks";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/tasks
 * Returns Harvey LAB benchmark tasks grouped by practice area.
 * Only accessible for the "openlaw" workspace.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    // Slug gate — Legal Benchmarks only for openlaw
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const userId = (session.user as { id: string }).id;
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!access.workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const practice_areas = HARVEY_LAB_TASKS.map((pa) => ({
      slug: pa.slug,
      label: pa.label,
      task_count: pa.tasks.length,
      tasks: pa.tasks,
    }));

    return NextResponse.json({ practice_areas, total: HARVEY_LAB_TOTAL });
  } catch (error) {
    logger.error("Error fetching Harvey LAB tasks", "LEGAL_BENCHMARKS", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
