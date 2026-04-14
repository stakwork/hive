import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { computeAggregateMetrics } from "@/lib/scorer/metrics";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    const window = searchParams.get("window") || "all";
    let since: Date | undefined;
    if (window === "24h") since = new Date(Date.now() - 86400000);
    else if (window === "7d") since = new Date(Date.now() - 604800000);
    else if (window === "30d") since = new Date(Date.now() - 2592000000);

    const result = await computeAggregateMetrics(workspaceId, since);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error computing scorer metrics:", error);
    return NextResponse.json(
      { error: "Failed to compute metrics" },
      { status: 500 }
    );
  }
}
