import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
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
    const limitParam = searchParams.get("limit");
    const pageParam = searchParams.get("page");

    const limit = limitParam ? Math.min(parseInt(limitParam), 100) : 10;
    const page = pageParam ? Math.max(parseInt(pageParam), 1) : 1;
    const skip = (page - 1) * limit;

    const workspace = await db.workspace.findFirst({
      where: { 
        slug,
        members: {
          some: { userId }
        }
      },
      include: {
        janitorConfig: true
      }
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    let config = workspace.janitorConfig;
    
    if (!config) {
      return NextResponse.json({
        recommendations: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        }
      });
    }

    const where: any = {
      janitorRun: {
        janitorConfigId: config.id,
      }
    };

    if (statusParam && ["PENDING", "ACCEPTED", "DISMISSED"].includes(statusParam.toUpperCase())) {
      where.status = statusParam.toUpperCase() as RecommendationStatus;
    }

    if (janitorTypeParam && ["UNIT_TESTS", "INTEGRATION_TESTS"].includes(janitorTypeParam.toUpperCase())) {
      where.janitorRun.janitorType = janitorTypeParam.toUpperCase() as JanitorType;
    }

    if (priorityParam && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priorityParam.toUpperCase())) {
      where.priority = priorityParam.toUpperCase() as Priority;
    }

    const [recommendations, total] = await Promise.all([
      db.janitorRecommendation.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { priority: "desc" },
          { createdAt: "desc" }
        ],
        skip,
        take: limit,
        include: {
          janitorRun: {
            select: {
              id: true,
              janitorType: true,
              status: true,
              createdAt: true,
            }
          },
          acceptedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          },
          dismissedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      }),
      db.janitorRecommendation.count({ where })
    ]);

    const pagination = {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    };

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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}