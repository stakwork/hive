import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { syncStakgraph } from "@/services/swarm/stakgraph-sync";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspaceId, swarmId } = body as {
      workspaceId?: string;
      swarmId?: string;
    };

    const result = await syncStakgraph(userOrResponse.id, { workspaceId, swarmId }, request);

    return NextResponse.json(
      {
        success: result.success,
        status: result.status,
        ...(result.message && { message: result.message }),
        ...(result.requestId && { requestId: result.requestId }),
      },
      { status: result.status }
    );
  } catch (error) {
    console.error("Error syncing stakgraph:", error);
    return NextResponse.json({ success: false, message: "Failed to sync" }, { status: 500 });
  }
}
