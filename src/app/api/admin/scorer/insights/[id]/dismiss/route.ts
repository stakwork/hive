import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const insight = await db.scorerInsight.update({
      where: { id },
      data: { dismissedAt: new Date() },
    });

    return NextResponse.json({ success: true, id: insight.id });
  } catch (error) {
    console.error("Error dismissing insight:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
