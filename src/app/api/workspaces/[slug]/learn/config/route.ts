import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";

const updateLearnConfigSchema = z.object({
  autoLearnEnabled: z.boolean(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const isSuperAdmin = await checkIsSuperAdmin(userId);

    const workspaceAccess = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspaceAccess.workspace.id },
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
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const isSuperAdmin = await checkIsSuperAdmin(userId);
    const body = await request.json();
    const validatedData = updateLearnConfigSchema.parse(body);

    const workspaceAccess = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
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
