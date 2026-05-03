import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  resolveWorkspaceAccess,
  requireReadAccess,
  requireMemberAccess,
} from "@/lib/auth/workspace-access";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { WorkspaceRole } from "@/lib/auth/roles";

const updateLearnConfigSchema = z.object({
  autoLearnEnabled: z.boolean(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: ok.workspaceId },
      select: { autoLearnEnabled: true },
    });

    return NextResponse.json({
      config: {
        autoLearnEnabled: swarm?.autoLearnEnabled ?? false,
      },
    });
  } catch (error) {
    console.error("Error fetching learn config:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const validatedData = updateLearnConfigSchema.parse(body);

    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    // Require DEVELOPER+ to toggle auto-learn (matches the previous canWrite gate).
    const roleLevel = WORKSPACE_PERMISSION_LEVELS[ok.role];
    if (roleLevel < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: ok.workspaceId },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not configured for this workspace" }, { status: 404 });
    }

    const updatedSwarm = await db.swarm.update({
      where: { id: swarm.id },
      data: { autoLearnEnabled: validatedData.autoLearnEnabled },
      select: { autoLearnEnabled: true },
    });

    return NextResponse.json({
      success: true,
      config: {
        autoLearnEnabled: updatedSwarm.autoLearnEnabled,
      },
    });
  } catch (error) {
    console.error("Error updating learn config:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
