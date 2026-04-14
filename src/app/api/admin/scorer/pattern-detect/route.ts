import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { analyzePatterns } from "@/lib/scorer/analysis";

/**
 * POST — manually trigger pattern detection for a workspace.
 * Body: { workspaceId: string, digestIds?: string[] }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { workspaceId, digestIds } = body as {
      workspaceId?: string;
      digestIds?: string[];
    };

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    const result = await analyzePatterns(workspaceId, digestIds);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running pattern detection:", error);
    return NextResponse.json(
      { error: "Failed to run pattern detection" },
      { status: 500 }
    );
  }
}
