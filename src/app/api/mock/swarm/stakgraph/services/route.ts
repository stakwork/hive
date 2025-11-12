import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakgraph services setup
 * GET /api/swarm/stakgraph/services - Setup services for swarm
 * Note: No authentication required for mock endpoints
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");
    const repoUrl = searchParams.get("repo_url");

    console.log("[Mock Stakgraph] Setting up services:", {
      workspaceId,
      swarmId: swarmId?.substring(0, 10) + "...",
      repoUrl
    });

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 600 + 300));

    const requestId = `[MOCK]services-${Math.floor(Math.random() * 10000) + 1000}`;

    // Randomly choose between synchronous and asynchronous processing
    const useAsyncProcessing = Math.random() > 0.3; // 70% chance of async

    if (useAsyncProcessing) {
      // Asynchronous processing (triggers SSE agent-stream)
      const mockResponse = {
        success: true,
        status: "PROCESSING",
        data: {
          request_id: requestId,
          workspace_id: workspaceId,
          swarm_id: swarmId,
          processing_started_at: new Date().toISOString(),
          estimated_completion: "2-5 minutes",
        },
        message: "Services setup started - processing in background"
      };

      console.log("[Mock Stakgraph] Async processing started:", requestId);
      return NextResponse.json(mockResponse);
    } else {
      // Synchronous processing (immediate completion)
      const mockServices = [
        {
          name: "[MOCK]stakgraph-service",
          status: "active",
          port: 3355,
          health_check: "/health"
        },
        {
          name: "[MOCK]jarvis-service",
          status: "active",
          port: 8444,
          health_check: "/api/health"
        },
        {
          name: "[MOCK]code-analysis-service",
          status: "active",
          port: 9000,
          health_check: "/status"
        }
      ];

      const mockResponse = {
        success: true,
        status: "COMPLETED",
        data: {
          request_id: requestId,
          workspace_id: workspaceId,
          swarm_id: swarmId,
          services: mockServices,
          environment_variables: {
            REPO_URL: repoUrl,
            WORKSPACE_ID: workspaceId,
            SWARM_ID: swarmId,
            MOCK_MODE: "true"
          },
          completed_at: new Date().toISOString(),
        },
        message: "Services setup completed successfully"
      };

      console.log("[Mock Stakgraph] Synchronous setup completed:", requestId);
      return NextResponse.json(mockResponse);
    }
  } catch (error) {
    console.error("Error in mock Stakgraph services:", error);
    return NextResponse.json({
      success: false,
      error: "Failed to setup services"
    }, { status: 500 });
  }
}