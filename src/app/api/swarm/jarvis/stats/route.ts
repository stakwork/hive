import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for dashboard graph statistics
 * Returns statistics about the knowledge graph including:
 * - Function nodes count
 * - Variable nodes count
 * - Contributor nodes count
 * - Call episode nodes count
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");

    if (!workspaceId) {
      return NextResponse.json({ success: false, message: "Workspace ID is required" }, { status: 400 });
    }

    // Mock statistics data for the dashboard
    const mockStats = {
      function_nodes: 50,
      variable_nodes: 50,
      contributors: 3,
      call_episodes: 5,
      total_nodes: 108, // Sum of above counts
      last_updated: new Date().toISOString(),
    };

    return NextResponse.json(
      {
        success: true,
        data: mockStats,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Stats fetch error:", error);
    return NextResponse.json({ success: false, message: "Failed to get stats" }, { status: 500 });
  }
}
