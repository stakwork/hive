import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";

const updateRepairConfigSchema = z.object({
  repairAgentDisabled: z.boolean(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    const workspaceAccess = await validateWorkspaceAccess(slug, userId, true);
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspaceAccess.workspace.id },
      select: { repairAgentDisabled: true },
    });

    return NextResponse.json({
      config: {
        repairAgentDisabled: swarm?.repairAgentDisabled ?? false,
      },
    });
  } catch (error) {
    console.error("Error fetching repair config:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const body = await request.json();
    const validatedData = updateRepairConfigSchema.parse(body);

    const workspaceAccess = await validateWorkspaceAccess(slug, userId, true);
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    // Check if user has sufficient permissions (canWrite = at least DEVELOPER role)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspaceAccess.workspace.id },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not configured for this workspace" }, { status: 404 });
    }

    const updatedSwarm = await db.swarm.update({
      where: { id: swarm.id },
      data: { repairAgentDisabled: validatedData.repairAgentDisabled },
      select: { repairAgentDisabled: true },
    });

    return NextResponse.json({
      success: true,
      config: {
        repairAgentDisabled: updatedSwarm.repairAgentDisabled,
      },
    });
  } catch (error) {
    console.error("Error updating repair config:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Validation failed", details: (error as { issues: unknown }).issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
