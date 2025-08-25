import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";
import { WizardStateResponse, WizardStateError } from "@/types/wizard";
import { ServiceDataConfig } from "@/components/stakgraph";

export async function GET(request: NextRequest) {
  try {
    // Get session and validate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        } as WizardStateError,
        { status: 401 },
      );
    }

    const userId = (session.user as { id: string }).id;

    // Get workspace slug from query parameters
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace slug is required",
        } as WizardStateError,
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
        } as WizardStateError,
        { status: 403 },
      );
    }

    // Get workspace details
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace not found",
        } as WizardStateError,
        { status: 404 },
      );
    }

    // Get swarm for this workspace
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspace.id,
      },
    });

    // If no swarm exists, return empty response
    if (!swarm) {
      return NextResponse.json(
        {
          success: false,
          message: "No swarm found for workspace",
        } as WizardStateError,
        { status: 200 },
      );
    }

    // Parse wizard data if it's a string
    let wizardData: Record<string, unknown> = {};
    if (typeof swarm.wizardData === "string") {
      try {
        wizardData = JSON.parse(swarm.wizardData);
      } catch (error) {
        console.warn("Failed to parse wizard data:", error);
        wizardData = {};
      }
    } else if (
      typeof swarm.wizardData === "object" &&
      swarm.wizardData !== null
    ) {
      wizardData = swarm.wizardData as Record<string, unknown>;
    }

    // Prepare response
    const response: WizardStateResponse = {
      success: true,
      data: {
        wizardStep: swarm.wizardStep,
        stepStatus: swarm.stepStatus || "PENDING",
        wizardData,
        swarmId: swarm.swarmId || undefined,
        swarmStatus: swarm.status,
        swarmName: swarm.name,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        services: Array.isArray(swarm.services)
          ? (swarm.services as unknown as ServiceDataConfig[])
          : [],
        ingestRefId: swarm.ingestRefId || "",
        poolName: swarm.poolName || "",
        repoName: swarm.repositoryName || "",
        repositoryUrl: swarm.repositoryUrl || "",
        user: {
          id: userId,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching wizard state:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      } as WizardStateError,
      { status: 500 },
    );
  }
}
