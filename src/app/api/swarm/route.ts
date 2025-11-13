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
import { logger } from "@/lib/logger";

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

    logger.debug(`[SWARM_CREATE] Starting swarm creation for workspace: ${workspaceId}, repository: ${repositoryUrl}, user: ${session.user.id}`, "swarm/route");

    if (!workspaceId || !repositoryUrl) {
      logger.debug(`[SWARM_CREATE] Missing required fields - workspaceId: ${!!workspaceId}, repositoryUrl: ${!!repositoryUrl}`, "swarm/route");
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: workspaceId, repositoryUrl",
        },
        { status: 400 },
      );
    }

    // Validate workspace access - ensure user has admin permissions to create swarms
    logger.debug(`[SWARM_CREATE] Validating workspace access for user ${session.user.id} in workspace ${workspaceId}`);
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      logger.debug(`[SWARM_CREATE] Access denied for user ${session.user.id} in workspace ${workspaceId}`);
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 403 });
    }

    if (!workspaceAccess.canAdmin) {
      logger.debug(`[SWARM_CREATE] Admin permission denied for user ${session.user.id} in workspace ${workspaceId}`);
      return NextResponse.json(
        {
          success: false,
          message: "Only workspace owners and admins can create swarms",
        },
        { status: 403 },
      );
    }

    logger.debug(`[SWARM_CREATE] Access validated - user ${session.user.id} has admin access to workspace ${workspaceId}`);

    // Ensure workspace is linked to SourceControlOrg before proceeding
    logger.debug(`[SWARM_CREATE] Checking workspace SourceControlOrg linkage`);
    const workspaceData = await db.workspace.findUnique({
      where: { id: workspaceId },
      include: { sourceControlOrg: true },
    });

    if (workspaceData && !workspaceData.sourceControlOrg) {
      logger.debug(`[SWARM_CREATE] Workspace not linked to SourceControlOrg, attempting to link`, "swarm/route");

      // Extract GitHub owner from repository URL
      const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)/);
      if (githubMatch) {
        const githubOwner = githubMatch[1];
        logger.debug(`[SWARM_CREATE] Extracted GitHub owner: ${githubOwner}`);

        // Look for existing SourceControlOrg for this GitHub owner
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: githubOwner },
        });

        if (sourceControlOrg) {
          // Link workspace to existing SourceControlOrg
          await db.workspace.update({
            where: { id: workspaceId },
            data: { sourceControlOrgId: sourceControlOrg.id },
          });
          logger.debug(`[SWARM_CREATE] Successfully linked workspace ${workspaceId} to SourceControlOrg: ${sourceControlOrg.githubLogin} (ID: ${sourceControlOrg.id})`);
        } else {
          logger.debug(`[SWARM_CREATE] No SourceControlOrg found for GitHub owner: ${githubOwner}`);
        }
      } else {
        logger.warn(`[SWARM_CREATE] Could not extract GitHub owner from repository URL: ${repositoryUrl}`);
      }
    } else if (workspaceData?.sourceControlOrg) {
      logger.debug(`[SWARM_CREATE] Workspace already linked to SourceControlOrg: ${workspaceData.sourceControlOrg.githubLogin} (ID: ${workspaceData.sourceControlOrg.id})`);
    }

    // Check for existing swarm and create placeholder in single transaction
    logger.debug(`[SWARM_CREATE] Starting transaction to check/create swarm for workspace ${workspaceId}`);
    const result = await db.$transaction(async (tx) => {
      // Check for existing swarm
      logger.debug(`[SWARM_CREATE] Checking for existing swarm in workspace ${workspaceId}`);
      const existingSwarm = await tx.swarm.findFirst({
        where: {
          workspaceId: workspaceId,
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (existingSwarm) {
        logger.debug(`[SWARM_CREATE] Found existing swarm - ID: ${existingSwarm.id}, SwarmId: ${existingSwarm.swarmId}, Status: ${existingSwarm.status}`, "swarm/route");
        return {
          exists: true,
          swarm: existingSwarm
        };
      }

      logger.debug(`[SWARM_CREATE] No existing swarm found, creating placeholder for workspace ${workspaceId}`, "swarm/route");
      // Create placeholder swarm record immediately to reserve the workspace
      const placeholderSwarm = await tx.swarm.create({
        data: {
          workspaceId,
          name: randomUUID(), // Temporary name
          instanceType: SWARM_DEFAULT_INSTANCE_TYPE,
          status: SwarmStatus.PENDING, // Mark as pending during creation
          // Leave other fields null/empty until external API completes
        },
      });
      logger.debug(`[SWARM_CREATE] Created placeholder swarm - ID: ${placeholderSwarm.id}, Status: ${placeholderSwarm.status}`, "swarm/route");

      // Create repository record in the same transaction
      if (repositoryUrl) {
        logger.debug(`[SWARM_CREATE] Creating repository record for ${repositoryUrl}`);
        const repoName = repositoryName || repositoryUrl.split("/").pop()?.replace(/\.git$/, "") || "repository";
        const branch = repositoryDefaultBranch || "main";

        const createdRepo = await tx.repository.create({
          data: {
            name: repoName,
            repositoryUrl,
            branch,
            workspaceId,
            status: RepositoryStatus.PENDING,
          },
        });
        logger.debug(`[SWARM_CREATE] Created repository record - ID: ${createdRepo.id}, Name: ${repoName}`, "swarm/route");
      }

      return {
        exists: false,
        swarm: placeholderSwarm
      };
    });
    logger.debug(`[SWARM_CREATE] Transaction completed - exists: ${result.exists}, swarm ID: ${result.swarm.id}`, "swarm/route");

    // If swarm already exists, return it
    if (result.exists) {
      logger.debug(`[SWARM_CREATE] Returning existing swarm for workspace ${workspaceId} - ID: ${result.swarm.id}, SwarmId: ${result.swarm.swarmId}, Status: ${result.swarm.status}`, "swarm/route");
      return NextResponse.json({
        success: true,
        message: "Swarm already exists for this workspace",
        data: { id: result.swarm.id, swarmId: result.swarm.swarmId },
      }, { status: 200 });
    }

    // Now make external API call with workspace already reserved
    logger.debug(`[SWARM_CREATE] Starting external swarm creation for placeholder ID: ${result.swarm.id}`);
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;
    const swarmConfig = getServiceConfig("swarm");
    const swarmService = new SwarmService(swarmConfig);
    const swarmPassword = generateSecurePassword(20);

    logger.debug(`[SWARM_CREATE] Generated password length: ${swarmPassword.length}, instance type: ${instance_type}`, "swarm/route");

    try {
      logger.debug(`[SWARM_CREATE] Calling external SwarmService.createSwarm()`);
      const startTime = Date.now();

      // Create external swarm (this can take 5-30 seconds)
      const apiResponse = await swarmService.createSwarm({
        instance_type,
        password: swarmPassword,
      });

      const apiCallDuration = Date.now() - startTime;
      logger.debug(`[SWARM_CREATE] External API call completed in ${apiCallDuration}ms`);

      const swarm_id = apiResponse?.data?.swarm_id;
      const swarm_address = apiResponse?.data?.address;
      const x_api_key = apiResponse?.data?.x_api_key;
      const ec2_id = apiResponse?.data?.ec2_id;

      logger.debug(`[SWARM_CREATE] API Response data - swarm_id: ${swarm_id}, address: ${swarm_address}, ec2_id: ${ec2_id}, x_api_key: ${x_api_key ? 'present' : 'missing'}`, "swarm/route");

      // Use swarm_id directly for secret alias
      const swarmSecretAlias = swarm_id ? `{{${swarm_id}_API_KEY}}` : undefined;

      logger.debug(`[SWARM_CREATE] Updating placeholder ${result.swarm.id} with external API data`);
      // Update the placeholder record with real data (using saveOrUpdateSwarm for proper encryption)
      const updatedSwarm = await saveOrUpdateSwarm({
        workspaceId: workspaceId,
        name: swarm_id, // Use swarm_id as name
        status: SwarmStatus.ACTIVE,
        swarmUrl: `https://${swarm_address}/api`,
        ec2Id: ec2_id,
        swarmApiKey: x_api_key,
        swarmSecretAlias: swarmSecretAlias,
        swarmId: swarm_id,
        swarmPassword: swarmPassword,
      });

      logger.debug(`[SWARM_CREATE] Successfully updated swarm ${updatedSwarm.id} to ACTIVE status with swarmId: ${swarm_id}`);

      return NextResponse.json({
        success: true,
        message: `Swarm was created successfully`,
        data: { id: updatedSwarm.id, swarmId: swarm_id },
      });

    } catch (error) {
      console.error(`[SWARM_CREATE] External API call failed for placeholder ${result.swarm.id}:`, error);

      // If external API fails, mark the placeholder as failed
      logger.debug(`[SWARM_CREATE] Marking placeholder ${result.swarm.id} as FAILED`);
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
    const body = await request.json().catch(() => ({}));
    const workspaceId = body.workspaceId || 'unknown';
    console.error(`[SWARM_CREATE] Top-level error caught for workspace ${workspaceId}:`, error);

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status: number }).status === "number"
    ) {
      const status = (error as { status: number }).status;
      const errorMessage = "message" in error ? error.message : "Failed to create swarm";

      logger.debug(`[SWARM_CREATE] Returning structured error - status: ${status}, message: ${errorMessage}`, "swarm/route");
      return NextResponse.json({ success: false, message: errorMessage }, { status });
    }

    logger.debug(`[SWARM_CREATE] Returning generic error for workspace ${workspaceId}`);
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
    logger.error("Error creating Swarm:", { error });
    return NextResponse.json({ success: false, message: "Failed to create swarm" }, { status: 500 });
  }
}
