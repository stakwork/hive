import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { decryptEnvVars } from "@/lib/encryption";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";
import { saveOrUpdateSwarm, select as swarmSelect } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { getWorkspaceBySlug } from "@/services/workspace";
import type { SwarmSelectResult } from "@/types/swarm";
import { syncPM2AndServices, extractRepoName } from "@/utils/stakgraphSync";
import { SwarmStatus } from "@prisma/client";
import { ServiceConfig as SwarmServiceConfig } from "@/services/swarm/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryRepository } from "@/lib/helpers/repository";

import { z } from "zod";

export const runtime = "nodejs";

// Validation schema for stakgraph settings - all fields optional for partial updates
const stakgraphSettingsSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  repositories: z
    .array(
      z.object({
        id: z.string().optional(),
        repositoryUrl: z.string().url("Invalid repository URL"),
        branch: z.string().min(1, "Branch is required"),
        name: z.string().min(1, "Repository name is required"),
      }),
    )
    .optional(),
  swarmUrl: z.string().url("Invalid swarm URL").optional(),
  swarmSecretAlias: z.string().min(1, "Swarm API key is required").optional(),
  swarmApiKey: z.string().optional(),
  poolName: z.string().min(1, "Pool name is required").optional(),
  poolCpu: z.string().optional(),
  poolMemory: z.string().optional(),
  description: z.string().optional(),
  containerFiles: z.record(z.string(), z.string()).optional(),
  environmentVariables: z
    .array(
      z.object({
        name: z.string().min(1, "Environment variable key is required"),
        value: z.string(),
      }),
    )
    .optional(),
  services: z
    .array(
      z.object({
        name: z.string().min(1, "Service name is required"),
        port: z.preprocess(
          (val) => {
            if (val === undefined || val === null || val === "") return NaN;
            return Number(val);
          },
          z.number().int().min(1, "Port is required"),
        ),
        scripts: z.object({
          start: z.string().min(1, "Start script is required"),
          install: z.string().optional(),
          build: z.string().optional(),
          test: z.string().optional(),
          e2eTest: z.string().optional(),
          preStart: z.string().optional(),
          postStart: z.string().optional(),
          rebuild: z.string().optional(),
          reset: z.string().optional(),
        }),
        dev: z.boolean().optional(),
        env: z.record(z.string(), z.string()).optional(),
        language: z.string().optional(),
        interpreter: z.string().optional(),
        cwd: z.string().optional(),
      }),
    )
    .optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
          error: "UNAUTHORIZED",
        },
        { status: 401 },
      );
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid user session",
          error: "INVALID_SESSION",
        },
        { status: 401 },
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace not found",
          error: "WORKSPACE_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const swarm = (await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: swarmSelect,
    })) as SwarmSelectResult | null;

    if (!swarm) {
      return NextResponse.json(
        {
          success: false,
          message: "No swarm found for this workspace",
          error: "SWARM_NOT_FOUND",
        },
        { status: 200 },
      );
    }

   await db.repository.findMany({
     where: { workspaceId: workspace.id },
     select: {
       id: true,
       repositoryUrl: true,
       branch: true,
     },
     orderBy: { createdAt: "asc" },
   });

    const environmentVariables = swarm?.environmentVariables;

    const repositories = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        repositoryUrl: true,
        branch: true,
        name: true,
        githubWebhookId: true,
        githubWebhookSecret: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      message: "Pool settings retrieved successfully",
      data: {
        name: swarm.name || "",
        description: "",
        repositories: repositories.length > 0 ? repositories : [],
        swarmUrl: swarm.swarmUrl || "",
        swarmSecretAlias: swarm.swarmSecretAlias || "",
        poolName: swarm.id || "",
        poolCpu: swarm.poolCpu || "2",
        poolMemory: swarm.poolMemory || "8Gi",
        environmentVariables:
          typeof environmentVariables === "string"
            ? (() => {
                try {
                  const parsed = JSON.parse(environmentVariables);
                  if (Array.isArray(parsed)) {
                    try {
                      return decryptEnvVars(parsed as Array<{ name: string; value: unknown }>);
                    } catch {
                      return parsed;
                    }
                  }
                  return parsed;
                } catch {
                  return environmentVariables;
                }
              })()
            : Array.isArray(environmentVariables)
              ? (() => {
                  try {
                    return decryptEnvVars(
                      environmentVariables as Array<{
                        name: string;
                        value: unknown;
                      }>,
                    );
                  } catch {
                    return environmentVariables;
                  }
                })()
              : environmentVariables,
        services: typeof swarm.services === "string" ? JSON.parse(swarm.services) : swarm.services || [],
        status: swarm.status,
        lastUpdated: swarm.updatedAt,
        containerFiles: swarm.containerFiles || [],
        webhookEnsured:
          repositories.length > 0 && repositories[0]
            ? Boolean(repositories[0].githubWebhookId && repositories[0].githubWebhookSecret)
            : false,
      },
    });
  } catch (error) {
    console.error("Error retrieving stakgraph settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  console.log("PUT request received");

  try {
    const { slug } = await params;

    // Check for API token auth (for external services like Stakwork repair agent)
    const apiToken = request.headers.get("x-api-token");
    const isApiTokenAuth = apiToken && apiToken === process.env.API_TOKEN;

    let workspace: { id: string } | null = null;
    let userId: string | null = null;

    if (isApiTokenAuth) {
      // API token auth - get workspace by slug directly (no user session needed)
      workspace = await db.workspace.findFirst({
        where: { slug, deleted: false },
        select: { id: true },
      });
    } else {
      // Session auth path
      const session = await getServerSession(authOptions);

      if (!session?.user) {
        return NextResponse.json(
          {
            success: false,
            message: "Authentication required",
            error: "UNAUTHORIZED",
          },
          { status: 401 },
        );
      }

      userId = (session.user as { id?: string })?.id || null;
      if (!userId) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid user session",
            error: "INVALID_SESSION",
          },
          { status: 401 },
        );
      }

      workspace = await getWorkspaceBySlug(slug, userId);
    }

    if (!workspace) {
      return NextResponse.json(
        {
          success: false,
          message: "Workspace not found",
          error: "WORKSPACE_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const body = await request.json();
    const validationResult = stakgraphSettingsSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation failed",
          error: "VALIDATION_ERROR",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const settings = validationResult.data;

    // Only process repositories if provided
    if (settings.repositories && settings.repositories.length > 0) {
      const existingRepos = await db.repository.findMany({
        where: { workspaceId: workspace.id },
      });

      const incomingRepos = settings.repositories;
      const existingRepoIds = existingRepos.map((r) => r.id);
      const incomingRepoIds = incomingRepos.filter((r) => r.id).map((r) => r.id!);

      const reposToCreate = incomingRepos.filter((r) => !r.id);
      if (reposToCreate.length > 0) {
        await db.repository.createMany({
          data: reposToCreate.map((repo) => ({
            workspaceId: workspace.id,
            repositoryUrl: repo.repositoryUrl,
            branch: repo.branch,
            name: repo.name,
          })),
        });
      }

      const reposToUpdate = incomingRepos.filter((r) => r.id);
      for (const repo of reposToUpdate) {
        await db.repository.update({
          where: { id: repo.id },
          data: {
            repositoryUrl: repo.repositoryUrl,
            branch: repo.branch,
            name: repo.name,
          },
        });
      }

      const repoIdsToDelete = existingRepoIds.filter((id) => !incomingRepoIds.includes(id));
      if (repoIdsToDelete.length > 0) {
        await db.repository.deleteMany({
          where: {
            id: { in: repoIdsToDelete },
            workspaceId: workspace.id,
          },
        });
      }
    }

    // Fetch existing swarm for merge (partial update support)
    const existingSwarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        name: true,
        swarmUrl: true,
        swarmSecretAlias: true,
        poolName: true,
        poolCpu: true,
        poolMemory: true,
        services: true,
        containerFiles: true,
        environmentVariables: true,
      },
    });

    // Get repo name for pm2 generation
    const primaryRepo = await getPrimaryRepository(workspace.id);
    const repoName = extractRepoName(
      primaryRepo?.repositoryUrl || settings.repositories?.[0]?.repositoryUrl
    );

    // Perform bidirectional sync for services/containerFiles
    const syncResult = syncPM2AndServices(
      (existingSwarm?.services as unknown as SwarmServiceConfig[]) || [],
      (existingSwarm?.containerFiles as unknown as Record<string, string>) || {},
      settings.services as SwarmServiceConfig[] | undefined,
      settings.containerFiles,
      repoName
    );

    // Merge all fields - use incoming if provided, else preserve existing
    // Convert null to undefined for database fields
    await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: settings.name ?? existingSwarm?.name ?? undefined,
      swarmUrl: settings.swarmUrl ?? existingSwarm?.swarmUrl ?? undefined,
      status: SwarmStatus.ACTIVE,
      swarmSecretAlias: settings.swarmSecretAlias ?? existingSwarm?.swarmSecretAlias ?? undefined,
      swarmApiKey: settings.swarmApiKey,
      poolName: settings.poolName ?? existingSwarm?.poolName ?? undefined,
      poolCpu: settings.poolCpu ?? existingSwarm?.poolCpu ?? undefined,
      poolMemory: settings.poolMemory ?? existingSwarm?.poolMemory ?? undefined,
      services: syncResult.services,
      environmentVariables: settings.environmentVariables,
      containerFiles: syncResult.containerFiles,
    });

    const swarm = (await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: swarmSelect,
    })) as SwarmSelectResult | null;

    if (!swarm) {
      return NextResponse.json(
        {
          success: false,
          message: "Swarm not found",
          error: "SWARM_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    let swarmPoolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    if (!swarmPoolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      swarmPoolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }

    // Only setup GitHub webhook when using session auth (not API token auth)
    if (!isApiTokenAuth && userId) {
      try {
        const callbackUrl = getGithubWebhookCallbackUrl(workspace.id, request);
        const webhookService = new WebhookService(getServiceConfig("github"));

        // Reuse primaryRepo from above if available
        if (primaryRepo) {
          const { defaultBranch } = await webhookService.setupRepositoryWithWebhook({
            userId,
            workspaceId: workspace.id,
            repositoryUrl: primaryRepo.repositoryUrl,
            callbackUrl,
            repositoryName: primaryRepo.name,
          });

          console.log("=====> GitHub defaultBranch:", defaultBranch, "Current branch:", primaryRepo.branch);
          if (defaultBranch && defaultBranch !== primaryRepo.branch) {
            console.log("=====> Updating primary repository branch to:", defaultBranch);
            await db.repository.update({
              where: { id: primaryRepo.id },
              data: { branch: defaultBranch },
            });
          }
        }
      } catch (err) {
        console.error("Failed to setup repository with webhook:", err);
      }
    }

    // Use merged values for pool name check (convert null to undefined)
    const mergedPoolName = settings.poolName ?? existingSwarm?.poolName ?? undefined;
    const mergedPoolCpu = settings.poolCpu ?? existingSwarm?.poolCpu ?? undefined;
    const mergedPoolMemory = settings.poolMemory ?? existingSwarm?.poolMemory ?? undefined;

    // After updating/creating the swarm, sync settings to Pool Manager
    if (mergedPoolName && swarmPoolApiKey && swarm && Array.isArray(settings.environmentVariables)) {
      const syncResult2 = await syncPoolManagerSettings({
        workspaceId: workspace.id,
        workspaceSlug: slug,
        swarmId: swarm.id,
        poolApiKey: swarmPoolApiKey,
        poolCpu: mergedPoolCpu,
        poolMemory: mergedPoolMemory,
        environmentVariables: settings.environmentVariables as Array<{ name: string; value: string }>,
        containerFiles: syncResult.containerFiles,
        userId: userId || undefined,
      });

      if (!syncResult2.success) {
        console.error("Failed to sync settings to Pool Manager:", syncResult2.error);
      }
    }

    const typedSwarm = swarm as SwarmSelectResult & { poolApiKey?: string };

    // Fetch updated repositories for response
    const updatedRepositories = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        repositoryUrl: true,
        branch: true,
        name: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      message: "Pool settings saved successfully",
      data: {
        id: typedSwarm.id,
        name: typedSwarm.name || "",
        description: settings.description || "",
        repositories: updatedRepositories,
        swarmUrl: typedSwarm.swarmUrl,
        poolName: typedSwarm.poolName,
        swarmSecretAlias: typedSwarm.swarmSecretAlias || "",
        services: typeof typedSwarm.services === "string" ? JSON.parse(typedSwarm.services) : typedSwarm.services || [],
        containerFiles: typedSwarm.containerFiles || {},
        status: typedSwarm.status,
        updatedAt: typedSwarm.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error saving stakgraph settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to save stakgraph settings",
        error: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}

//
