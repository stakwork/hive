import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { listFeatures, createFeature } from "@/services/roadmap";
import type {
  CreateFeatureRequest,
  FeatureListResponse,
  FeatureResponse,
} from "@/types/roadmap";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");

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

    const result = await listFeatures(workspaceId, userId, page, limit);

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
    const status = message.includes("not found") || message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const body: CreateFeatureRequest = await request.json();

    if (!body.title || !body.workspaceId) {
      return NextResponse.json(
        { error: "Missing required fields: title, workspaceId" },
        { status: 400 },
      );
    }

    const feature = await createFeature(userId, body);

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
    const status = message.includes("not found") || message.includes("denied") ? 403 :
                   message.includes("required") || message.includes("Invalid") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
