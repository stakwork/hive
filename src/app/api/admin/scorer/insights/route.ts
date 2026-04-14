import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const severity = searchParams.get("severity");
    const mode = searchParams.get("mode");
    const showDismissed = searchParams.get("dismissed") === "true";

    const where: Record<string, unknown> = {};
    if (workspaceId) where.workspaceId = workspaceId;
    if (severity) where.severity = severity.toUpperCase();
    if (mode) where.mode = mode;
    if (!showDismissed) where.dismissedAt = null;

    const insights = await db.scorerInsight.findMany({
      where,
      orderBy: [
        { severity: "asc" }, // HIGH first
        { createdAt: "desc" },
      ],
      include: {
        workspace: { select: { name: true, slug: true } },
      },
    });

    return NextResponse.json({ insights });
  } catch (error) {
    console.error("Error fetching insights:", error);
    return NextResponse.json(
      { error: "Failed to fetch insights" },
      { status: 500 }
    );
  }
}
