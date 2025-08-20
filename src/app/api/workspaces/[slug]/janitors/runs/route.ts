import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getJanitorRuns } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/lib/helpers/janitor-permissions";
import { parseJanitorType, parseJanitorStatus, validatePaginationParams } from "@/lib/helpers/janitor-validation";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { JanitorType, JanitorStatus } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    
    const typeParam = searchParams.get("type");
    const statusParam = searchParams.get("status");
    const { limit, page } = validatePaginationParams(
      searchParams.get("limit"),
      searchParams.get("page")
    );

    const { workspace } = await validateWorkspaceAccess(slug, userId, "VIEW");

    const filters: {
      type?: JanitorType;
      status?: JanitorStatus;
      limit: number;
      page: number;
    } = { limit, page };

    if (typeParam) {
      try {
        filters.type = parseJanitorType(typeParam);
      } catch {
        // Ignore invalid type, don't filter
      }
    }

    if (statusParam) {
      try {
        filters.status = parseJanitorStatus(statusParam);
      } catch {
        // Ignore invalid status, don't filter
      }
    }

    const { runs, pagination } = await getJanitorRuns(workspace.id, filters);

    return NextResponse.json({
      runs: runs.map(run => ({
        id: run.id,
        janitorType: run.janitorType,
        status: run.status,
        triggeredBy: run.triggeredBy,
        stakworkProjectId: run.stakworkProjectId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        recommendationCount: run._count?.recommendations || 0,
      })),
      pagination
    });
  } catch (error) {
    console.error("Error fetching janitor runs:", error);
    
    if (error instanceof Error && error.message === JANITOR_ERRORS.WORKSPACE_NOT_FOUND) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}