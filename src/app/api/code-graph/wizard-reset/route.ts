import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";
import { SwarmWizardStep, StepStatus } from "@prisma/client";
import { WizardResetRequest, WizardResetResponse } from "@/types/wizard";

export async function POST(request: NextRequest) {
  try {
    // Get session and validate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        } as WizardResetResponse,
        { status: 401 },
      );
    }

    // Parse request body
    const body: WizardResetRequest = await request.json();
    const { workspaceSlug } = body;

    if (!workspaceSlug) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace slug is required",
        } as WizardResetResponse,
        { status: 400 },
      );
    }

    // Validate workspace access
    const validatedSlug = await validateUserWorkspaceAccess(
      session,
      workspaceSlug,
    );
    if (!validatedSlug) {
      return NextResponse.json(
        {
          success: false,
          message: "Access denied to workspace",
        } as WizardResetResponse,
        { status: 403 },
      );
    }

    // Get workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace not found",
        } as WizardResetResponse,
        { status: 404 },
      );
    }

    // Find existing swarm
    const existingSwarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspace.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingSwarm) {
      return NextResponse.json(
        {
          success: false,
          message: "No swarm found for workspace",
        } as WizardResetResponse,
        { status: 404 },
      );
    }

    // Reset swarm to initial wizard state
    const resetSwarm = await db.swarm.update({
      where: {
        id: existingSwarm.id,
      },
      data: {
        wizardStep: "WELCOME" as SwarmWizardStep,
        stepStatus: "PENDING" as StepStatus,
        wizardData: {},
      },
      select: {
        wizardStep: true,
        stepStatus: true,
        wizardData: true,
      },
    });

    // Parse wizard data if it's a string
    let parsedWizardData: Record<string, unknown> = {};
    if (typeof resetSwarm.wizardData === "string") {
      try {
        parsedWizardData = JSON.parse(resetSwarm.wizardData);
      } catch (error) {
        console.warn("Failed to parse wizard data:", error);
        parsedWizardData = {};
      }
    } else if (
      typeof resetSwarm.wizardData === "object" &&
      resetSwarm.wizardData !== null
    ) {
      parsedWizardData = resetSwarm.wizardData as Record<string, unknown>;
    }

    return NextResponse.json({
      success: true,
      data: {
        wizardStep: resetSwarm.wizardStep,
        stepStatus: resetSwarm.stepStatus,
        wizardData: parsedWizardData,
      },
      message: "Wizard reset to beginning successfully",
    } as WizardResetResponse);
  } catch (error) {
    console.error("Error resetting wizard:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      } as WizardResetResponse,
      { status: 500 },
    );
  }
}
