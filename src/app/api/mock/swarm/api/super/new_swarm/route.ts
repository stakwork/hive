import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Swarm new_swarm API
 * POST /api/super/new_swarm - Create a new swarm
 * Note: No authentication required for mock endpoints
 */
export async function POST(request: NextRequest) {
  try {

    const body = await request.json();
    console.log("[Mock Swarm] Creating new swarm with instance type:", body.instance_type);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

    const swarmId = `mock-swarm-${Math.floor(Math.random() * 10000) + 1000}`;
    const mockResponse = {
      success: true,
      message: `${swarmId} was created successfully`,
      data: {
        swarm_id: swarmId,
        address: `${swarmId}.sphinx.chat`,
        ec2_id: `i-${Math.random().toString(36).substr(2, 17)}`,
        x_api_key: Math.random().toString(36).substr(2, 32),
      }
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Swarm new_swarm:", error);
    return NextResponse.json({ error: "Failed to create swarm" }, { status: 500 });
  }
}