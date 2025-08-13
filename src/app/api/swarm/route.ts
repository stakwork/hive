import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import {
  SWARM_DEFAULT_ENV_VARS,
  SWARM_DEFAULT_INSTANCE_TYPE,
  getSwarmVanityAddress,
} from "@/lib/constants";
import { SwarmService } from "@/services/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { createFakeSwarm, isFakeMode } from "@/services/swarm/fake";
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
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();

    const {
      workspaceId,
      name,
      repositoryName,
      repositoryUrl,
      repositoryDescription,
      repositoryDefaultBranch,
    } = body;

    if (!workspaceId || !name || !repositoryName || !repositoryUrl) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Missing required fields: workspaceId, name, repositoryName, repositoryUrl",
        },
        { status: 400 },
      );
    }

    const vanity_address = getSwarmVanityAddress(name);
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;
    const env = SWARM_DEFAULT_ENV_VARS;

    await saveOrUpdateSwarm({
      workspaceId,
      name: vanity_address,
      instanceType: instance_type,
      status: SwarmStatus.PENDING,
      repositoryName: repositoryName || "",
      repositoryUrl: repositoryUrl || "",
      repositoryDescription: repositoryDescription || "",
      defaultBranch: repositoryDefaultBranch || "",
    });

    const swarmConfig = getServiceConfig("swarm");
    const swarmService = new SwarmService(swarmConfig);

    const thirdPartyName = `${name.toLowerCase()}-Swarm`;

    const apiResponse = await swarmService.createSwarm({
      vanity_address,
      name: thirdPartyName,
      instance_type,
      env,
    });

    const swarm_id = apiResponse?.data?.swarm_id;
    const updatedSwarm = await saveOrUpdateSwarm({
      workspaceId,
      swarmUrl: `https://${vanity_address}/api`,
      status: SwarmStatus.PENDING,
      swarmId: swarm_id,
    });

    return NextResponse.json({
      success: true,
      message: `${name}-Swarm was created successfully`,
      data: { id: updatedSwarm.id, swarmId: swarm_id },
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
      const errorMessage =
        "message" in error ? error.message : "Failed to create swarm";

      return NextResponse.json(
        { success: false, message: errorMessage },
        { status },
      );
    }

    return NextResponse.json(
      { success: false, message: "Unknown error while creating swarm" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
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

    const updatedSwarm = await saveOrUpdateSwarm({
      workspaceId: workspaceId,
      environmentVariables: envVars,
      services,
    });

    return NextResponse.json({
      success: true,
      message: "Swarm updated successfully",
      data: { id: updatedSwarm.id },
    });
  } catch (error) {
    console.error("Error creating Swarm:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create swarm" },
      { status: 500 },
    );
  }
}
