import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";
import { SwarmWizardStep, StepStatus, Prisma } from "@prisma/client";
import { WizardProgressRequest, WizardProgressResponse } from "@/types/wizard";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { enumFromString } from "@/utils/enum";

const WIZARD_STEP_ORDER: SwarmWizardStep[] = [
  SwarmWizardStep.WELCOME,
  SwarmWizardStep.REPOSITORY_SELECT,
  SwarmWizardStep.PROJECT_NAME,
  SwarmWizardStep.GRAPH_INFRASTRUCTURE,
  SwarmWizardStep.INGEST_CODE,
  SwarmWizardStep.ADD_SERVICES,
  SwarmWizardStep.ENVIRONMENT_SETUP,
  SwarmWizardStep.REVIEW_POOL_ENVIRONMENT,
  SwarmWizardStep.STAKWORK_SETUP,
  SwarmWizardStep.COMPLETION,
];

const VALID_STATUS_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  PENDING: ["STARTED", "PROCESSING"],
  STARTED: ["PROCESSING", "COMPLETED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: ["STARTED", "PENDING"],
  FAILED: ["STARTED", "PROCESSING"],
};

function validateStepTransition(
  currentStep: SwarmWizardStep,
  newStep: SwarmWizardStep,
): boolean {
  const currentIndex = WIZARD_STEP_ORDER.indexOf(currentStep);
  const newIndex = WIZARD_STEP_ORDER.indexOf(newStep);

  return newIndex >= 0 && currentIndex >= 0;
}

function validateStatusTransition(
  currentStatus: StepStatus,
  newStatus: StepStatus,
): boolean {
  return (
    VALID_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ||
    currentStatus === newStatus
  );
}

export async function PUT(request: NextRequest) {
  try {
    // Get session and validate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        } as WizardProgressResponse,
        { status: 401 },
      );
    }

    // Parse request body
    const body: WizardProgressRequest = await request.json();
    const { workspaceSlug, wizardStep, stepStatus, wizardData } = body;

    // Convert types to Prisma enums if provided
    const prismaWizardStep = enumFromString(
      SwarmWizardStep,
      wizardStep,
      SwarmWizardStep.WELCOME,
    );
    const prismaStepStatus = enumFromString(
      StepStatus,
      stepStatus,
      StepStatus.PENDING,
    );

    if (!workspaceSlug) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace slug is required",
        } as WizardProgressResponse,
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
        } as WizardProgressResponse,
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
        } as WizardProgressResponse,
        { status: 404 },
      );
    }

    // Get current swarm state or create one if it doesn't exist
    const currentSwarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        wizardStep: true,
        stepStatus: true,
        wizardData: true,
      },
    });

    const swarm = await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      wizardStep: prismaWizardStep,
      stepStatus: prismaStepStatus,
      wizardData: (wizardData ?? {}) as Prisma.InputJsonValue,
    });

    if (
      prismaWizardStep &&
      currentSwarm &&
      !validateStepTransition(currentSwarm.wizardStep, prismaWizardStep)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid wizard step transition from ${currentSwarm.wizardStep} to ${prismaWizardStep}`,
        } as WizardProgressResponse,
        { status: 400 },
      );
    }

    if (
      prismaStepStatus &&
      currentSwarm &&
      !validateStatusTransition(currentSwarm.stepStatus, prismaStepStatus)
    ) {
      console.log(
        "Invalid step status transition from",
        currentSwarm.stepStatus,
        "to",
        prismaStepStatus,
      );
    }

    let parsedWizardData: Record<string, unknown> = {};
    if (typeof swarm.wizardData === "string") {
      try {
        parsedWizardData = JSON.parse(swarm.wizardData);
      } catch (error) {
        console.warn("Failed to parse wizard data:", error);
        parsedWizardData = {};
      }
    } else if (
      typeof swarm.wizardData === "object" &&
      swarm.wizardData !== null
    ) {
      parsedWizardData = swarm.wizardData as Record<string, unknown>;
    }

    return NextResponse.json({
      success: true,
      data: {
        wizardStep: swarm.wizardStep,
        stepStatus: swarm.stepStatus,
        wizardData: parsedWizardData,
      },
    } as WizardProgressResponse);
  } catch (error) {
    console.error("Error updating wizard progress:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      } as WizardProgressResponse,
      { status: 500 },
    );
  }
}
