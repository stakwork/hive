import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Feature Documentation Endpoint
 *
 * PUT - Updates documentation for a specific feature/concept
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth validation
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json(
        { error: "Missing x-api-token header" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { documentation } = body;

    if (!documentation) {
      return NextResponse.json(
        { error: "documentation is required" },
        { status: 400 }
      );
    }

    const { id } = params;

    console.log(`[StakgraphMock] PUT /gitree/features/${id}/documentation`);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[StakgraphMock] PUT /gitree/features/:id/documentation error:", error);
    return NextResponse.json(
      { error: "Failed to update feature documentation" },
      { status: 500 }
    );
  }
}
