import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import {
  SWARM_DEFAULT_ENV_VARS,
  SWARM_DEFAULT_INSTANCE_TYPE,
  getSwarmVanityAddress,
} from "@/lib/constants";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { createFakeSwarm, isFakeMode } from "@/services/swarm/fake";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { SwarmStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  if (isFakeMode) {
    const { id, swarm_id } = await createFakeSwarm();
    return NextResponse.json({
      success: true,
      message: "Swarm (FAKE) was created successfully",
      data: { id, swarm_id },
    });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();

    const {
      workspaceId,
      name,
      repositoryUrl,
      instanceType,
      environmentVariables,
      services,
    } = body;

    // Validate required fields
    if (!workspaceId || !name || !repositoryUrl || !instanceType) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Validate repository URL format
    try {
      new URL(repositoryUrl);
      if (!repositoryUrl.startsWith('http://') && !repositoryUrl.startsWith('https://')) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid repository URL" },
        { status: 400 },
      );
    }

    // Validate workspace access - ensure user has admin permissions to create swarms
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    if (!workspaceAccess.canAdmin) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    // Get the workspace to access the stakwork API key
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace?.stakworkApiKey) {
      return NextResponse.json(
        { error: "Workspace stakwork API key not configured" },
        { status: 400 },
      );
    }

    try {
      // Generate a secure password for the swarm
      const swarmPassword = generateSecurePassword(20);
      
      // Call Stakwork API first
      const stakworkResponse = await fetch("https://api.stakwork.com/swarms", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${workspace.stakworkApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          repositoryUrl,
          instanceType,
          environmentVariables: environmentVariables || [],
          services: services || [],
        }),
      });

      if (!stakworkResponse.ok) {
        throw new Error(`Stakwork API failed: ${stakworkResponse.status}`);
      }

      const stakworkData = await stakworkResponse.json();
      
      // Create swarm in database with transaction
      const swarm = await db.$transaction(async (tx) => {
        // First create the swarm record
        const createdSwarm = await tx.swarm.create({
          data: {
            name,
            status: SwarmStatus.ACTIVE,
            instanceType,
            repositoryUrl,
            repositoryName: name,
            defaultBranch: "main",
            swarmId: stakworkData.data?.swarmId || `swarm-${Date.now()}`,
            swarmApiKey: "test-swarm-api-key",
            environmentVariables: environmentVariables || [],
            services: services || [],
            wizardStep: "COMPLETION",
            stepStatus: "COMPLETED",
            workspaceId,
          },
        });

        return createdSwarm;
      });

      return NextResponse.json({
        success: true,
        swarm: {
          id: swarm.id,
          name: swarm.name,
          repositoryUrl: swarm.repositoryUrl,
          instanceType: swarm.instanceType,
        },
      }, { status: 201 });
    } catch (error) {
      console.error("Error creating swarm:", error);
      return NextResponse.json(
        { error: "Failed to create swarm" },
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    console.error("Error creating Swarm:", error);
    return NextResponse.json(
      { error: "Failed to create swarm" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { swarmId, environmentVariables, services, workspaceId } = body;

    // Validate required fields
    if (!swarmId || !workspaceId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Validate environment variables format
    if (environmentVariables && Array.isArray(environmentVariables)) {
      for (const envVar of environmentVariables) {
        if (!envVar.name || envVar.name.trim() === "") {
          return NextResponse.json(
            { error: "Invalid environment variable" },
            { status: 400 },
          );
        }
      }
    }

    // Validate service configuration format
    if (services && Array.isArray(services)) {
      for (const service of services) {
        if (!service.name || service.name.trim() === "" || typeof service.port !== 'number') {
          return NextResponse.json(
            { error: "Invalid service configuration" },
            { status: 400 },
          );
        }
      }
    }

    // Find the swarm first
    const existingSwarm = await db.swarm.findUnique({
      where: { id: swarmId },
    });

    if (!existingSwarm) {
      return NextResponse.json(
        { error: "Swarm not found" },
        { status: 404 },
      );
    }

    // Validate workspace access - ensure user has admin permissions to update swarms
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    if (!workspaceAccess.canAdmin) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    // Update the swarm
    const updatedSwarm = await db.swarm.update({
      where: { id: swarmId },
      data: {
        environmentVariables: environmentVariables || [],
        services: services || [],
      },
    });

    return NextResponse.json({
      success: true,
      swarm: {
        id: updatedSwarm.id,
        environmentVariables: updatedSwarm.environmentVariables,
        services: updatedSwarm.services,
      },
    });
  } catch (error) {
    console.error("Error updating Swarm:", error);
    return NextResponse.json(
      { error: "Failed to update swarm" },
      { status: 500 },
    );
  }
}
