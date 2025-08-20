import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getJanitorRecommendations } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/lib/helpers/janitor-permissions";
import { parseJanitorType, parseRecommendationStatus, parsePriority, validatePaginationParams } from "@/lib/helpers/janitor-validation";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { JanitorType, RecommendationStatus, Priority } from "@prisma/client";

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
    
    const statusParam = searchParams.get("status");
    const janitorTypeParam = searchParams.get("janitorType");
    const priorityParam = searchParams.get("priority");
    const { limit, page } = validatePaginationParams(
      searchParams.get("limit"),
      searchParams.get("page")
    );

    const { workspace } = await validateWorkspaceAccess(slug, userId, "VIEW");

    const filters: {
      status?: RecommendationStatus;
      janitorType?: JanitorType;
      priority?: Priority;
      limit: number;
      page: number;
    } = { limit, page };

    if (statusParam) {
      try {
        filters.status = parseRecommendationStatus(statusParam);
      } catch {
        // Ignore invalid status, don't filter
      }
    }

    if (janitorTypeParam) {
      try {
        filters.janitorType = parseJanitorType(janitorTypeParam);
      } catch {
        // Ignore invalid janitor type, don't filter
      }
    }

    if (priorityParam) {
      try {
        filters.priority = parsePriority(priorityParam);
      } catch {
        // Ignore invalid priority, don't filter
      }
    }

    const { recommendations, pagination } = await getJanitorRecommendations(workspace.id, filters);

    return NextResponse.json({
      recommendations: recommendations.map(rec => ({
        id: rec.id,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        impact: rec.impact,
        status: rec.status,
        acceptedAt: rec.acceptedAt,
        dismissedAt: rec.dismissedAt,
        metadata: rec.metadata,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        janitorRun: rec.janitorRun,
        acceptedBy: rec.acceptedBy,
        dismissedBy: rec.dismissedBy,
      })),
      pagination
    });
  } catch (error) {
    console.error("Error fetching janitor recommendations:", error);
    
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