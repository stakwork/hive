import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { poolManagerService } from "@/lib/service-factory";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { EnvironmentVariable } from "@/types";
import { isApiError } from "@/types/errors";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import {
  devcontainerJsonContent,
  dockerComposeContent,
  dockerfileContent,
  formatPM2Apps,
  generatePM2Apps,
} from "@/utils/devContainerUtils";
import { ServiceDataConfig } from "@/components/stakgraph/types";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

function isPoolAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const message = (error as { message?: unknown }).message;
  const details = (error as { details?: unknown }).details;

  const includesAlreadyExists = (value: unknown) =>
    typeof value === "string" && value.toLowerCase().includes("already exists");

  if (includesAlreadyExists(message)) return true;

  if (typeof details === "string" && includesAlreadyExists(details)) {
    return true;
  }

  if (details && typeof details === "object" && "error" in details) {
    return includesAlreadyExists((details as { error?: unknown }).error);
  }

  return false;
}

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
      // Do not retry on non-retryable errors (e.g., pool already exists)
      if (isPoolAlreadyExistsError(error)) {
        throw error;
      }

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
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { swarmId, workspaceId } = body;

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

    // Generate container files from database services and environment variables
    let finalContainerFiles: Record<string, string> = {};

    if (swarm.containerFiles &&
        typeof swarm.containerFiles === 'object' &&
        Object.keys(swarm.containerFiles).length > 0) {
      // Use existing container files if they exist
      finalContainerFiles = swarm.containerFiles as Record<string, string>;
      console.log("Using existing container files from database");
    } else {
      console.log("Generating container files from database services");

      // Get repository name for file generation
      const repository = await db.repository.findFirst({
        where: { workspaceId: swarm.workspaceId },
      });
      const repoName = repository?.name || swarm.workspace.slug;

      // Convert swarm services to ServiceDataConfig format
      let services: ServiceDataConfig[] = [];
      if (swarm.services) {
        try {
          const parsedServices = typeof swarm.services === 'string'
            ? JSON.parse(swarm.services)
            : swarm.services;
          services = Array.isArray(parsedServices) ? parsedServices : [];
        } catch (error) {
          console.warn("Failed to parse swarm services:", error);
          services = [];
        }
      }

      // Generate container files using existing utilities
      const pm2Apps = generatePM2Apps(repoName, services);
      const containerFiles = {
        "devcontainer.json": devcontainerJsonContent(repoName),
        "pm2.config.js": `module.exports = {\n  apps: ${formatPM2Apps(pm2Apps)},\n};\n`,
        "docker-compose.yml": dockerComposeContent(),
        "Dockerfile": dockerfileContent(),
      };

      // Base64 encode the generated files
      finalContainerFiles = Object.entries(containerFiles).reduce(
        (acc, [name, content]) => {
          acc[name] = Buffer.from(content).toString("base64");
          return acc;
        },
        {} as Record<string, string>
      );

      // Save generated container files to database
      await saveOrUpdateSwarm({
        swarmId,
        workspaceId,
        containerFiles: finalContainerFiles,
      });
      console.log("Generated and saved new container files to database");
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

    // Get all repositories for this workspace to support multi-repo
    const repositories = await db.repository.findMany({
      where: {
        workspaceId: swarm.workspaceId,
      },
    });

    // Use first repository as primary (for backward compatibility)
    const primaryRepository = repositories[0];

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

    // Build repositories array for multi-repo support
    const repositoriesConfig = repositories.length > 1
      ? repositories.map(repo => ({
          url: repo.repositoryUrl,
          branch: repo.branch || "",
        }))
      : undefined;

    const pool = await withRetry(
      () => poolManager.createPool({
        pool_name: swarm.id,
        minimum_vms: 2,
        repo_name: primaryRepository?.repositoryUrl || "",
        branch_name: primaryRepository?.branch || "",
        repositories: repositoriesConfig,
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

    // Treat existing pools as idempotent success
    if (isPoolAlreadyExistsError(error)) {
      await saveOrUpdateSwarm({
        swarmId: body.swarmId,
        workspaceId,
        poolName: body.swarmId,
        poolState: 'COMPLETE',
      });
      return NextResponse.json(
        { pool: { name: body.swarmId, status: "already_exists" } },
        { status: 200 }
      );
    }

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
