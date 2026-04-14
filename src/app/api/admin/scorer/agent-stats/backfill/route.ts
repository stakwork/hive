import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { backfillWorkspaceAgentStats } from "@/lib/scorer/agent-stats";

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = (await request.json()) as { workspaceId?: string };
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    const result = await backfillWorkspaceAgentStats(workspaceId);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running agent stats backfill:", error);
    return NextResponse.json(
      { error: "Failed to run backfill" },
      { status: 500 }
    );
  }
}
