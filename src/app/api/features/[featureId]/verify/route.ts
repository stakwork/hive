import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ArtifactType } from "@prisma/client";
import {
  resolveWorkspaceAccess,
  requireMemberAccess,
  requireReadAccess,
} from "@/lib/auth/workspace-access";
import { startVerification } from "@/services/attestor/trigger";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId, deleted: false },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const access = await resolveWorkspaceAccess(request, { workspaceId: feature.workspaceId });
    const member = requireMemberAccess(access);
    if (member instanceof NextResponse) return member;

    const result = await startVerification(featureId, member.userId);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[attestor] verify trigger failed:", error);
    return NextResponse.json(
      {
        error: "Failed to start verification",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId, deleted: false },
      select: { workspaceId: true, workflowStatus: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const access = await resolveWorkspaceAccess(request, { workspaceId: feature.workspaceId });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const artifact = await db.artifact.findFirst({
      where: {
        type: ArtifactType.VERIFY,
        message: { featureId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, createdAt: true },
    });

    return NextResponse.json({
      workflowStatus: feature.workflowStatus,
      checklist: artifact?.content ?? null,
      artifactId: artifact?.id ?? null,
      createdAt: artifact?.createdAt ?? null,
    });
  } catch (error) {
    console.error("[attestor] verify fetch failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
