import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser } from "@/lib/auth/public-redact";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const featureId = searchParams.get("featureId");

    // If featureId is provided, get whiteboard by feature.
    if (featureId) {
      const whiteboard = await db.whiteboard.findUnique({
        where: { featureId },
        include: {
          feature: { select: { id: true, title: true, workspaceId: true } },
        },
      });

      if (!whiteboard || !whiteboard.feature) {
        // `feature` is null-typed because the relation is optional; in
        // practice the `where: { featureId }` filter guarantees it, but
        // guard for TS and the edge case of a dangling whiteboard.
        return NextResponse.json({ success: true, data: null }, { status: 200 });
      }

      const feature = whiteboard.feature;
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: feature.workspaceId,
      });
      const ok = requireReadAccess(access);
      if (ok instanceof NextResponse) return ok;

      return NextResponse.json({
        success: true,
        data: {
          id: whiteboard.id,
          name: whiteboard.name,
          featureId: whiteboard.featureId,
          feature: {
            id: feature.id,
            title: feature.title,
          },
          elements: whiteboard.elements,
          appState: whiteboard.appState,
          files: whiteboard.files,
          createdAt: whiteboard.createdAt,
          updatedAt: whiteboard.updatedAt,
        },
      });
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 }
      );
    }

    const access = await resolveWorkspaceAccess(request, { workspaceId });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;
    const redactForPublic = isPublicViewer(ok);

    const createdByIdParam = searchParams.get("createdById");
    const whereClause: Record<string, unknown> = { workspaceId };
    if (createdByIdParam && createdByIdParam !== "ALL") {
      whereClause.createdById = createdByIdParam;
    }

    // Sort & pagination params
    const sortByParam = searchParams.get("sortBy") ?? "updatedAt";
    const sortOrderParam = searchParams.get("sortOrder") ?? "desc";
    const pageParam = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limitParam = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "24", 10) || 24));

    const validSortBy = ["createdAt", "updatedAt"] as const;
    const validSortOrder = ["asc", "desc"] as const;
    if (!validSortBy.includes(sortByParam as (typeof validSortBy)[number])) {
      return NextResponse.json({ error: "Invalid sortBy value" }, { status: 400 });
    }
    if (!validSortOrder.includes(sortOrderParam as (typeof validSortOrder)[number])) {
      return NextResponse.json({ error: "Invalid sortOrder value" }, { status: 400 });
    }

    const orderByClause = { [sortByParam]: sortOrderParam };

    const [whiteboards, totalCount] = await Promise.all([
      db.whiteboard.findMany({
        where: whereClause,
        orderBy: orderByClause,
        skip: (pageParam - 1) * limitParam,
        take: limitParam,
        select: {
          id: true,
          name: true,
          featureId: true,
          feature: {
            select: { id: true, title: true },
          },
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: { id: true, name: true, image: true },
          },
        },
      }),
      db.whiteboard.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limitParam);
    const publicSafeWhiteboards = redactForPublic
      ? whiteboards.map((w) => ({ ...w, createdBy: toPublicUser(w.createdBy) }))
      : whiteboards;
    return NextResponse.json({
      success: true,
      data: publicSafeWhiteboards,
      pagination: {
        page: pageParam,
        limit: limitParam,
        totalCount,
        totalPages,
        hasMore: pageParam < totalPages,
      },
    }, { status: 200 });
  } catch (error) {
    console.error("Error fetching whiteboards:", error);
    return NextResponse.json({ error: "Failed to fetch whiteboards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspaceId, name, featureId, elements, appState, files } = body;

    if (!workspaceId || !name) {
      return NextResponse.json(
        { error: "Missing required fields: workspaceId, name" },
        { status: 400 }
      );
    }

    // Verify user has access to workspace
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
        OR: [
          { ownerId: userOrResponse.id },
          { members: { some: { userId: userOrResponse.id } } },
        ],
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // If featureId provided, verify feature exists and belongs to workspace
    if (featureId) {
      const feature = await db.feature.findFirst({
        where: { id: featureId, workspaceId, deleted: false },
      });
      if (!feature) {
        return NextResponse.json({ error: "Feature not found" }, { status: 404 });
      }
    }

    const whiteboard = await db.whiteboard.create({
      data: {
        name,
        workspaceId,
        featureId: featureId || null,
        createdById: userOrResponse.id,
        elements: elements || [],
        appState: appState || {},
        files: files || {},
      },
      include: {
        feature: {
          select: { id: true, title: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: whiteboard }, { status: 201 });
  } catch (error) {
    console.error("Error creating whiteboard:", error);
    return NextResponse.json({ error: "Failed to create whiteboard" }, { status: 500 });
  }
}
