import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for GitSee visualization trigger
 * POST /api/gitsee/trigger - Trigger repository visualization
 * Note: No authentication required for mock endpoints
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repositoryUrl, workspaceId } = body;

    console.log("[Mock GitSee] Triggering visualization:", {
      repositoryUrl,
      workspaceId
    });

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 200));

    // Extract repo name from URL for visualization ID
    const repoName = repositoryUrl?.split('/').pop()?.replace(/\.git$/, '') || 'repository';
    const visualizationId = `[MOCK]viz-${repoName}-${Math.floor(Math.random() * 1000)}`;

    const mockResponse = {
      success: true,
      data: {
        visualization_id: visualizationId,
        repository_url: repositoryUrl,
        workspace_id: workspaceId,
        status: "triggered",
        estimated_completion: "3-10 minutes",
        triggered_at: new Date().toISOString(),
        preview_url: `https://mock-gitsee.com/viz/${visualizationId}`,
      },
      message: "Repository visualization triggered successfully"
    };

    console.log("[Mock GitSee] Visualization triggered:", visualizationId);
    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock GitSee trigger:", error);
    return NextResponse.json({
      success: false,
      error: "Failed to trigger visualization"
    }, { status: 500 });
  }
}