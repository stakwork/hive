import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Swarm details API
 * GET /api/super/details?id=... - Get swarm details
 * Note: No authentication required for mock endpoints
 */
export async function GET(request: NextRequest) {
  try {

    const { searchParams } = request.nextUrl;
    const swarmId = searchParams.get("id");

    if (!swarmId) {
      return NextResponse.json({ error: "Swarm ID parameter is required" }, { status: 400 });
    }

    console.log("[Mock Swarm] Getting details for swarm:", swarmId);

    // Simulate API delay and potential retries (like the real implementation)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 600 + 200));

    // Simulate different states
    const states = ["creating", "running", "stopping", "stopped", "error"];
    const randomState = states[Math.floor(Math.random() * states.length)];

    // Occasionally return 400 to simulate the retry behavior
    if (Math.random() < 0.1 && randomState === "creating") {
      return NextResponse.json({
        error: "Swarm still initializing",
        message: "Please try again in a few moments"
      }, { status: 400 });
    }

    const mockResponse = {
      id: swarmId,
      name: `[MOCK]swarm-${swarmId.split('-').pop()}`,
      status: randomState,
      created_at: new Date(Date.now() - Math.random() * 3600000).toISOString(), // Random time in last hour
      updated_at: new Date().toISOString(),
      region: "us-east-1",
      instance_type: "t3.medium",
      vanity_address: `${swarmId}-test-domain.com`,
      ports: {
        jarvis: 8444,
        stakgraph: 3355,
        app: 3000,
      },
      urls: {
        jarvis: `https://${swarmId}-test-domain.com:8444`,
        stakgraph: `https://${swarmId}-test-domain.com:3355`,
        app: `https://${swarmId}-test-domain.com:3000`,
      },
      health: {
        jarvis: randomState === "running" ? "healthy" : "initializing",
        stakgraph: randomState === "running" ? "healthy" : "initializing",
        app: randomState === "running" ? "healthy" : "initializing",
      },
      metrics: randomState === "running" ? {
        cpu_usage: Math.floor(Math.random() * 80) + 10,
        memory_usage: Math.floor(Math.random() * 70) + 20,
        disk_usage: Math.floor(Math.random() * 50) + 30,
        uptime_hours: Math.floor(Math.random() * 168) + 1, // 1-168 hours
      } : undefined,
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Swarm details:", error);
    return NextResponse.json({ error: "Failed to get swarm details" }, { status: 500 });
  }
}