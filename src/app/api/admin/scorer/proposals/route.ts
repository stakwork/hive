import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

/**
 * GET — list description proposals, optionally filtered by workspace,
 * insight, or status. Defaults to PENDING only.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const insightId = searchParams.get("insightId");
    const status = searchParams.get("status"); // e.g. "PENDING" | "all"

    const where: Record<string, unknown> = {};
    if (workspaceId) where.workspaceId = workspaceId;
    if (insightId) where.insightId = insightId;
    if (status && status !== "all") where.status = status.toUpperCase();
    else if (!status) where.status = "PENDING";

    const proposals = await db.scorerDescriptionProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error("Error fetching proposals:", error);
    return NextResponse.json(
      { error: "Failed to fetch proposals" },
      { status: 500 }
    );
  }
}
