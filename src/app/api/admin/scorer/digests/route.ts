import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { generateDigest } from "@/lib/scorer/digest";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    const where: Record<string, unknown> = {};
    if (workspaceId) where.workspaceId = workspaceId;

    const digests = await db.scorerDigest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        featureId: true,
        content: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ digests });
  } catch (error) {
    console.error("Error fetching digests:", error);
    return NextResponse.json(
      { error: "Failed to fetch digests" },
      { status: 500 }
    );
  }
}

/**
 * POST — generate a digest for a feature.
 * Body: { featureId: string }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { featureId } = body as { featureId?: string };

    if (!featureId) {
      return NextResponse.json(
        { error: "featureId is required" },
        { status: 400 }
      );
    }

    const content = await generateDigest(featureId);
    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error("Error generating digest:", error);
    return NextResponse.json(
      { error: "Failed to generate digest" },
      { status: 500 }
    );
  }
}
