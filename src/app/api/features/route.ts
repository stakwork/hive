import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { listFeatures, createFeature } from "@/services/roadmap";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import type {
  CreateFeatureRequest,
  FeatureListResponse,
  FeatureResponse,
} from "@/types/roadmap";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");

    // Filter params
    const statusParam = searchParams.get("status") || undefined;
    let statuses: FeatureStatus[] | undefined;

    if (statusParam) {
      const statusValues = statusParam.split(',').filter(Boolean);
      const validStatuses = Object.values(FeatureStatus);

      // Validate all status values
      const invalidStatuses = statusValues.filter(s => !validStatuses.includes(s as FeatureStatus));
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          { error: `Invalid status values: ${invalidStatuses.join(', ')}` },
          { status: 400 },
        );
      }

      statuses = statusValues as FeatureStatus[];
    }

    // Priority filter params
    const priorityParam = searchParams.get("priority") || undefined;
    let priorities: FeaturePriority[] | undefined;

    if (priorityParam) {
      const priorityValues = priorityParam.split(',').filter(Boolean);
      const validPriorities = Object.values(FeaturePriority);

      // Validate all priority values
      const invalidPriorities = priorityValues.filter(p => !validPriorities.includes(p as FeaturePriority));
      if (invalidPriorities.length > 0) {
        return NextResponse.json(
          { error: `Invalid priority values: ${invalidPriorities.join(', ')}` },
          { status: 400 },
        );
      }

      priorities = priorityValues as FeaturePriority[];
    }

    // Keep "UNASSIGNED" as string - service layer will convert to null for Prisma
    const assigneeId = searchParams.get("assigneeId") || undefined;

    // Keep "UNCREATED" as string - service layer will convert to null for Prisma
    const createdById = searchParams.get("createdById") || undefined;

    // Search param
    const search = searchParams.get("search") || undefined;

    // Sort params
    const sortBy = searchParams.get("sortBy") as "title" | "createdAt" | "updatedAt" | undefined;
    const sortOrder = searchParams.get("sortOrder") as "asc" | "desc" | undefined;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error:
            "Invalid pagination parameters. Page must be >= 1, limit must be 1-100",
        },
        { status: 400 },
      );
    }

    // Validate sortBy if provided
    if (sortBy && !["title", "createdAt", "updatedAt"].includes(sortBy)) {
      return NextResponse.json(
        { error: "Invalid sortBy parameter. Must be 'title', 'createdAt', or 'updatedAt'" },
        { status: 400 },
      );
    }

    // Validate sortOrder if provided
    if (sortOrder && !["asc", "desc"].includes(sortOrder)) {
      return NextResponse.json(
        { error: "Invalid sortOrder parameter. Must be 'asc' or 'desc'" },
        { status: 400 },
      );
    }

    const result = await listFeatures({
      workspaceId,
      userId: userOrResponse.id,
      page,
      limit,
      statuses,
      priorities,
      assigneeId,
      createdById,
      search,
      sortBy,
      sortOrder,
    });

    return NextResponse.json<FeatureListResponse>(
      {
        success: true,
        data: result.features,
        pagination: result.pagination,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching features:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch features";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body: CreateFeatureRequest = await request.json();

    if (!body.title || !body.workspaceId) {
      return NextResponse.json(
        { error: "Missing required fields: title, workspaceId" },
        { status: 400 },
      );
    }

    const feature = await createFeature(userOrResponse.id, body);

    return NextResponse.json<FeatureResponse>(
      {
        success: true,
        data: feature,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating feature:", error);
    const message = error instanceof Error ? error.message : "Failed to create feature";
    const status = message.includes("denied") ? 403 :
                   message.includes("not found") || message.includes("required") || message.includes("Invalid") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
