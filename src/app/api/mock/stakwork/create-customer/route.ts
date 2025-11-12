import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakwork customer creation
 * POST /api/stakwork/create-customer - Create a new Stakwork customer
 * Note: No authentication required for mock endpoints
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId } = body;

    console.log("[Mock Stakwork] Creating customer for workspace:", workspaceId);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));

    const customerId = `[MOCK]customer-${Math.floor(Math.random() * 10000) + 1000}`;

    const mockResponse = {
      success: true,
      data: {
        customer_id: customerId,
        workspace_id: workspaceId,
        status: "active",
        created_at: new Date().toISOString(),
      },
      message: "Customer created successfully"
    };

    console.log("[Mock Stakwork] Customer created:", customerId);
    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Stakwork create-customer:", error);
    return NextResponse.json({
      success: false,
      error: "Failed to create customer"
    }, { status: 500 });
  }
}