import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { SWARM_DEFAULT_INSTANCE_TYPE } from "@/lib/constants";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { createFakeSwarm, isFakeMode } from "@/services/swarm/fake";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { SwarmStatus } from "@prisma/client";
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

    const { workspaceId, name, repositoryName, repositoryUrl, repositoryDescription, repositoryDefaultBranch } = body;

    if (!workspaceId || !name || !repositoryName || !repositoryUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: workspaceId, name, repositoryName, repositoryUrl",
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

    // const vanity_address = getSwarmVanityAddress(name);
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;
    // const env = SWARM_DEFAULT_ENV_VARS;

    const swarmConfig = getServiceConfig("swarm");
    const swarmService = new SwarmService(swarmConfig);

    // Generate a secure password for the swarm
    const swarmPassword = generateSecurePassword(20);

    const apiResponse = await swarmService.createSwarm({
      instance_type,
      password: swarmPassword,
    });

    const swarm_id = apiResponse?.data?.swarm_id;
    const swarm_address = apiResponse?.data?.address;
    const x_api_key = apiResponse?.data?.x_api_key;
    const ec2_id = apiResponse?.data?.ec2_id;

    const match = typeof swarm_id === "string" ? swarm_id.match(/(\d+)/) : null;
    const swarm_id_num = match ? match[1] : swarm_id;
    const swarmSecretAlias = `{{SWARM_${swarm_id_num}_API_KEY}}`;

    // Create the swarm record in database only after successful external service creation
    const createdSwarm = await saveOrUpdateSwarm({
      workspaceId,
      name: swarm_id, // Use swarm_id as name so subsequent API requests can succeed
      instanceType: instance_type,
      status: SwarmStatus.ACTIVE,
      repositoryName: repositoryName || "",
      repositoryUrl: repositoryUrl || "",
      repositoryDescription: repositoryDescription || "",
      defaultBranch: repositoryDefaultBranch || "",
      swarmUrl: `https://${swarm_address}/api`,
      ec2Id: ec2_id,
      swarmApiKey: x_api_key,
      swarmSecretAlias: swarmSecretAlias,
      swarmId: swarm_id,
      swarmPassword: swarmPassword,
    });

    if (!createdSwarm) {
      return NextResponse.json({ success: false, message: "Failed to create swarm record" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `${name}-Swarm was created successfully`,
      data: { id: createdSwarm.id, swarmId: swarm_id },
    });
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
