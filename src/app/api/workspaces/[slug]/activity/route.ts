import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceActivity } from "@/services/activity";
import { getWorkspaceBySlug } from "@/services/workspace";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { slug } = await params;

    // Check user has access to workspace
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "5");

    // Fetch activity data
    const activityResponse = await getWorkspaceActivity(slug, limit);

    if (!activityResponse.success) {
      return NextResponse.json(
        { 
          error: activityResponse.error || "Failed to fetch activity",
          data: []
        },
        { status: activityResponse.error?.includes("not found") ? 404 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: activityResponse.data
    });

  } catch (error) {
    console.error("Activity API error:", error);
    return NextResponse.json(
      { error: "Internal server error", data: [] },
      { status: 500 }
    );
  }
}