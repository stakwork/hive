import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { SWARM_DEFAULT_INSTANCE_TYPE } from "@/lib/constants";
import { db } from "@/lib/db";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { createFakeSwarm, isFakeMode } from "@/services/swarm/fake";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { RepositoryStatus, SwarmStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const { workspaceId, repositoryUrl, repositoryName, repositoryDefaultBranch } = body;

    if (!workspaceId || !repositoryUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: workspaceId, repositoryUrl",
        },
        { status: 400 },
      );
    }

    // Validate workspace access - ensure user has admin permissions to create swarms
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 403 });
    }

    if (!workspaceAccess.canAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: "Only workspace owners and admins can create swarms",
        },
        { status: 403 },
      );
    }



    // Check for existing swarm and create placeholder in single transaction
    const result = await db.$transaction(async (tx) => {
      // Check for existing swarm
      const existingSwarm = await tx.swarm.findFirst({
        where: {
          workspaceId: workspaceId,
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (existingSwarm) {
        return {
          exists: true,
          swarm: existingSwarm
        };
      }

      // Create placeholder swarm record immediately to reserve the workspace
      const placeholderSwarm = await tx.swarm.create({
        data: {
          workspaceId,
          name: `placeholder-${Date.now()}`, // Temporary name
          instanceType: SWARM_DEFAULT_INSTANCE_TYPE,
          status: SwarmStatus.PENDING, // Mark as pending during creation
          // Leave other fields null/empty until external API completes
        },
      });

      // Create repository record in the same transaction
      if (repositoryUrl) {
        const repoName = repositoryName || repositoryUrl.split("/").pop()?.replace(/\.git$/, "") || "repository";
        const branch = repositoryDefaultBranch || "main";

        await tx.repository.create({
          data: {
            name: repoName,
            repositoryUrl,
            branch,
            workspaceId,
            status: RepositoryStatus.PENDING,
          },
        });
      }

      return {
        exists: false,
        swarm: placeholderSwarm
      };
    });

    // If swarm already exists, return it
    if (result.exists) {
      console.log('Swarm already exists for workspace:', workspaceId, 'Swarm ID:', result.swarm.swarmId);
      return NextResponse.json({
        success: true,
        message: "Swarm already exists for this workspace",
        data: { id: result.swarm.id, swarmId: result.swarm.swarmId },
      }, { status: 200 });
    }

    // Now make external API call with workspace already reserved
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;
    const swarmConfig = getServiceConfig("swarm");
    const swarmService = new SwarmService(swarmConfig);
    const swarmPassword = generateSecurePassword(20);

    try {
      // Create external swarm (this can take 5-30 seconds)
      const apiResponse = await swarmService.createSwarm({
        instance_type,
        password: swarmPassword,
      });

      const swarm_id = apiResponse?.data?.swarm_id;
      const swarm_address = apiResponse?.data?.address;
      const x_api_key = apiResponse?.data?.x_api_key;
      const ec2_id = apiResponse?.data?.ec2_id;

      // Use swarm_id directly for secret alias
      const swarmSecretAlias = swarm_id ? `{{${swarm_id}_API_KEY}}` : undefined;

      // Update the placeholder record with real data
      const updatedSwarm = await db.swarm.update({
        where: { id: result.swarm.id },
        data: {
          name: swarm_id, // Use swarm_id as name
          status: SwarmStatus.ACTIVE,
          swarmUrl: `https://${swarm_address}/api`,
          ec2Id: ec2_id,
          swarmApiKey: x_api_key,
          swarmSecretAlias: swarmSecretAlias,
          swarmId: swarm_id,
          swarmPassword: swarmPassword,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Swarm was created successfully`,
        data: { id: updatedSwarm.id, swarmId: swarm_id },
      });

    } catch (error) {
      // If external API fails, mark the placeholder as failed
      await db.swarm.update({
        where: { id: result.swarm.id },
        data: {
          status: SwarmStatus.FAILED,
        },
      });

      // Re-throw to be handled by outer catch block
      throw error;
    }
  } catch (error: unknown) {
    console.error("Error creating Swarm:", error);

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status: number }).status === "number"
    ) {
      const status = (error as { status: number }).status;
      const errorMessage = "message" in error ? error.message : "Failed to create swarm";

      return NextResponse.json({ success: false, message: errorMessage }, { status });
    }

    return NextResponse.json({ success: false, message: "Unknown error while creating swarm" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { envVars, services, workspaceId } = body;

    if (!envVars && !services) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: swarmId, envVars, services",
        },
        { status: 400 },
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required field: workspaceId",
        },
        { status: 400 },
      );
    }

    // Validate workspace access - ensure user has admin permissions to update swarms
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 403 });
    }

    if (!workspaceAccess.canAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: "Only workspace owners and admins can update swarms",
        },
        { status: 403 },
      );
    }

    const updatedSwarm = await saveOrUpdateSwarm({
      workspaceId: workspaceId,
      environmentVariables: envVars,
      services,
    });

    return NextResponse.json({
      success: true,
      message: "Swarm updated successfully",
      data: { id: updatedSwarm?.id },
    });
  } catch (error) {
    console.error("Error creating Swarm:", error);
    return NextResponse.json({ success: false, message: "Failed to create swarm" }, { status: 500 });
  }
}
