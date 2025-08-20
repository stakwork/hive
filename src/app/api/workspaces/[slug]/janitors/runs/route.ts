import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
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
      config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
        }
      });
    }

    const where: any = {
      janitorConfigId: config.id,
    };

    if (typeParam && ["UNIT_TESTS", "INTEGRATION_TESTS"].includes(typeParam.toUpperCase())) {
      where.janitorType = typeParam.toUpperCase() as JanitorType;
    }

    if (statusParam && ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(statusParam.toUpperCase())) {
      where.status = statusParam.toUpperCase() as JanitorStatus;
    }

    const [runs, total] = await Promise.all([
      db.janitorRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              recommendations: true
            }
          }
        }
      }),
      db.janitorRun.count({ where })
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
        recommendationCount: run._count.recommendations,
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