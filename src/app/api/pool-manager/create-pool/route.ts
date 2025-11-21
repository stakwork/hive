import { auth, getGithubUsernameAndPAT } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { poolManagerService } from "@/lib/service-factory";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { EnvironmentVariable } from "@/types";
import { isApiError } from "@/types/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {

  for (let i = 0; i <= retries; i++) {
    console.log('withRetry-start', delay)

    try {
      return await fn();
    } catch (error) {
      if (i === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Retry function failed unexpectedly");
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { swarmId, workspaceId, container_files } = body;

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    // Find the swarm and verify user has access to the workspace
    const swarm = await db.swarm.findFirst({
      where: {
        ...(swarmId ? { swarmId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: {
        workspace: {
          select: {
            id: true,
            slug: true,
            ownerId: true,
            members: {
              where: { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found" }, { status: 404 });
    }

    // Get poolApiKey from swarm
    let poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);

    // Use the workspace associated with this swarm for GitHub access
    const github_pat = await getGithubUsernameAndPAT(userId, swarm.workspace.slug);

    if (!poolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }

    // Check if swarm already has container files
    let finalContainerFiles = container_files;

    if (swarm.containerFiles && Object.keys(swarm.containerFiles).length > 0) {
      // Use existing container files if they exist
      finalContainerFiles = swarm.containerFiles;
      console.log("Using existing container files from database");
    } else {
      // Save new container files to database if none exist
      await saveOrUpdateSwarm({
        swarmId,
        workspaceId,
        containerFiles: container_files,
      });
      console.log("Saved new container files to database");
    }

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found" }, { status: 404 });
    }

    if (!swarm.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const isOwner = swarm.workspace.ownerId === userId;
    const isMember = swarm.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate required fields
    if (!swarm.id) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const repository = await db.repository.findFirst({
      where: {
        workspaceId: swarm.workspaceId,
      },
    });

    const poolManager = poolManagerService();
    poolManager.updateApiKey(encryptionService.decryptField("poolApiKey", poolApiKey));

    let envVars: EnvironmentVariable[] = [
      {
        name: "MY_ENV",
        value: "MY_VALUE",
      },
    ];
    if (typeof swarm.environmentVariables === "string") {
      try {
        const parsed = JSON.parse(swarm.environmentVariables);
        if (Array.isArray(parsed)) {
          const maybeEncrypted = parsed as Array<{
            name: string;
            value: unknown;
          }>;
          // Decrypt if values appear encrypted; fallback to as-is
          try {
            envVars = decryptEnvVars(maybeEncrypted).map(({ name, value }) => ({
              name,
              value,
            }));
          } catch {
            envVars = parsed as EnvironmentVariable[];
          }
        }
      } catch {
        // keep default
      }
    } else if (Array.isArray(swarm.environmentVariables)) {
      const arr = swarm.environmentVariables as Array<{
        name: string;
        value: unknown;
      }>;
      try {
        envVars = decryptEnvVars(arr).map(({ name, value }) => ({
          name,
          value,
        }));
      } catch {
        envVars = arr as unknown as EnvironmentVariable[];
      }
    }

    const pool = await withRetry(
      () => poolManager.createPool({
        pool_name: swarm.id,
        minimum_vms: 2,
        repo_name: repository?.repositoryUrl || "",
        branch_name: repository?.branch || "",
        github_pat: github_pat?.token || "",
        github_username: github_pat?.username || "",
        env_vars: envVars,
        container_files: finalContainerFiles,
      }),
      3,
      1000
    );

    saveOrUpdateSwarm({
      swarmId,
      workspaceId,
      poolName: swarmId,
      poolState: 'COMPLETE',
    });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (error) {
    console.error("Error creating Pool Manager pool:", error);
    const { workspaceId } = body;

    saveOrUpdateSwarm({
      workspaceId,
      poolState: 'FAILED',
    });

    // Handle ApiError specifically (two different formats)
    if (isApiError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.statusCode },
      );
    }

    // Handle HttpClient ApiError format (has status instead of statusCode)
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const httpError = error as { status: number; message: string; details?: unknown };
      return NextResponse.json(
        {
          error: httpError.message,
          details: httpError.details,
        },
        { status: httpError.status },
      );
    }

    return NextResponse.json({ error: "Failed to create pool" }, { status: 500 });
  }
}
