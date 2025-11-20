import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJanitorRuns } from "@/services/janitor";
import { parseJanitorType, parseJanitorStatus, validatePaginationParams } from "@/lib/helpers/janitor-validation";
import { JanitorType, JanitorStatus } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth();
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

    const { runs, pagination } = await getJanitorRuns(slug, userId, filters);

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
    
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}