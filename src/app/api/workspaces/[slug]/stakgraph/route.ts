import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { decryptEnvVars, encryptEnvVars } from "@/lib/encryption";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";
import { saveOrUpdateSwarm, select as swarmSelect } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { getWorkspaceBySlug } from "@/services/workspace";
import type { SwarmSelectResult } from "@/types/swarm";
import { syncPM2AndServices, extractRepoName } from "@/utils/stakgraphSync";
import { extractEnvVarsFromPM2Config, SERVICE_CONFIG_ENV_VARS } from "@/utils/devContainerUtils";
import { hasInfrastructureChange } from "@/utils/swarmInfraChanges";
import { SwarmStatus, PodState } from "@prisma/client";
import { ServiceConfig as SwarmServiceConfig } from "@/services/swarm/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

import type { ServiceDataConfig } from "@/components/stakgraph/types";

import { z } from "zod";

export const runtime = "nodejs";

/**
 * Decrypts environment variables from their stored format.
 * Handles both string (JSON-encoded) and array formats with graceful fallback.
 */
function decryptStoredEnvVars(environmentVariables: unknown): unknown {
  if (typeof environmentVariables === "string") {
    try {
      const parsed = JSON.parse(environmentVariables);
      if (!Array.isArray(parsed)) return parsed;
      try {
        return decryptEnvVars(parsed as Array<{ name: string; value: unknown }>);
      } catch {
        return parsed;
      }
    } catch {
      return environmentVariables;
    }
  }

  if (Array.isArray(environmentVariables)) {
    try {
      return decryptEnvVars(environmentVariables as Array<{ name: string; value: unknown }>);
    } catch {
      return environmentVariables;
    }
  }

  return environmentVariables;
}

/**
 * Parses swarm services from their stored format (string or array) and
 * populates each service with its environment variables from the table.
 */
function parseSwarmServices(
  rawServices: unknown,
  serviceEnvMap: Record<string, Record<string, string>>,
): ServiceDataConfig[] {
  const services: ServiceDataConfig[] =
    typeof rawServices === "string" ? JSON.parse(rawServices) : rawServices || [];
  return services.map((service) => ({
    ...service,
    env: serviceEnvMap[service.name] || service.env || {},
  }));
}

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
        codeIngestionEnabled: z.boolean().optional(),
        docsEnabled: z.boolean().optional(),
        mocksEnabled: z.boolean().optional(),
        embeddingsEnabled: z.boolean().optional(),
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
        name: z.string(), // Allow empty strings - they get filtered out before saving
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
        advanced: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
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

    const environmentVariables = swarm?.environmentVariables;

    // Fetch service-specific env vars from the table
    const serviceEnvVarsFromTable = await db.environmentVariable.findMany({
      where: {
        swarmId: swarm.id,
        serviceName: { not: "" }, // Only service-specific vars (not global)
      },
      select: {
        serviceName: true,
        name: true,
        value: true,
      },
    });

    // Group service env vars by service name and decrypt
    const serviceEnvMap: Record<string, Record<string, string>> = {};
    for (const envVar of serviceEnvVarsFromTable) {
      if (!envVar.serviceName) continue;
      
      if (!serviceEnvMap[envVar.serviceName]) {
        serviceEnvMap[envVar.serviceName] = {};
      }

      try {
        // Decrypt the value (it's stored as encrypted JSON string)
        const encryptedData = JSON.parse(envVar.value);
        const decrypted = decryptEnvVars([{ name: envVar.name, value: encryptedData }]);
        serviceEnvMap[envVar.serviceName][envVar.name] = decrypted[0]?.value || '';
      } catch (error) {
        console.warn(`[Stakgraph GET] Failed to decrypt env var ${envVar.name} for service ${envVar.serviceName}:`, error);
        // Fallback: try to use raw value if it's a string
        serviceEnvMap[envVar.serviceName][envVar.name] = typeof envVar.value === 'string' ? envVar.value : '';
      }
    }

    const repositories = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        repositoryUrl: true,
        branch: true,
        name: true,
        githubWebhookId: true,
        githubWebhookSecret: true,
        codeIngestionEnabled: true,
        docsEnabled: true,
        mocksEnabled: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      message: "Pool settings retrieved successfully",
      data: {
        name: swarm.name || "",
        description: swarm.description || "",
        repositories,
        swarmUrl: swarm.swarmUrl || "",
        swarmSecretAlias: swarm.swarmSecretAlias || "",
        poolName: swarm.id || "",
        poolCpu: swarm.poolCpu || "2",
        poolMemory: swarm.poolMemory || "8Gi",
        environmentVariables: decryptStoredEnvVars(environmentVariables),
        services: parseSwarmServices(swarm.services, serviceEnvMap),
        status: swarm.status,
        lastUpdated: swarm.updatedAt,
        containerFiles: swarm.containerFiles || [],
        webhookEnsured: repositories.length > 0
          && Boolean(repositories[0].githubWebhookId && repositories[0].githubWebhookSecret),
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

/**
 * Migrates environment variables from Swarm.environmentVariables JSON field to EnvironmentVariable table
 * Uses empty string for serviceName to indicate global scope
 * NOTE: Does NOT clear the old JSON field - keeps it for backward compatibility and fallback
 * @param swarmId - The swarm ID to migrate env vars for
 * @param environmentVariables - Array of env vars from the JSON field or incoming request
 * @returns Promise<void>
 */
async function migrateEnvironmentVariablesToTable(
  swarmId: string,
  environmentVariables: Array<{ name: string; value: string }> | undefined,
): Promise<void> {
  // Filter out service config vars and entries with empty names
  const filteredEnvVars = (environmentVariables || []).filter(
    (ev) => ev.name.trim() !== "" && !SERVICE_CONFIG_ENV_VARS.includes(ev.name)
  );

  // Always delete existing global env vars first
  await db.environmentVariable.deleteMany({
    where: {
      swarmId,
      serviceName: "",
    },
  });

  // If there are env vars to save, encrypt and insert them
  if (filteredEnvVars.length > 0) {
    const encrypted = encryptEnvVars(filteredEnvVars);
    await db.environmentVariable.createMany({
      data: encrypted.map((ev) => ({
        swarmId,
        serviceName: "", // Empty string indicates global scope
        name: ev.name,
        value: JSON.stringify(ev.value), // Store encrypted data as JSON string
      })),
    });
  }

  // Keep old JSON field for backward compatibility
  // (saveOrUpdateSwarm already handles this via environmentVariables parameter)
}

/**
 * Saves service-specific environment variables from services array to EnvironmentVariable table
 * @param swarmId - The swarm ID
 * @param services - Array of services with env fields
 * @returns Promise<void>
 */
async function saveServiceEnvironmentVariables(
  swarmId: string,
  services: Array<ServiceDataConfig> | undefined,
): Promise<void> {
  if (!services || services.length === 0) return;

  for (const service of services) {
    const serviceName = service.name;
    if (!serviceName) continue;

    const envVars = service.env || {};
    const envVarsArray = Object.entries(envVars)
      .filter(([key]) => key.trim() !== "" && !SERVICE_CONFIG_ENV_VARS.includes(key))
      .map(([key, value]) => ({ name: key, value }));

    // Delete existing service-specific env vars for this service
    await db.environmentVariable.deleteMany({
      where: {
        swarmId,
        serviceName: serviceName,
      },
    });

    // Encrypt and insert new env vars if any
    if (envVarsArray.length > 0) {
      const encrypted = encryptEnvVars(envVarsArray);
      await db.environmentVariable.createMany({
        data: encrypted.map((ev) => ({
          swarmId,
          serviceName: serviceName,
          name: ev.name,
          value: JSON.stringify(ev.value),
        })),
      });
    }
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

    // Track new repositories being created (needed for pending repair trigger)
    let reposToCreate: Array<{
      id?: string;
      repositoryUrl: string;
      branch: string;
      name: string;
      codeIngestionEnabled?: boolean;
      docsEnabled?: boolean;
      mocksEnabled?: boolean;
      embeddingsEnabled?: boolean;
    }> = [];

    // Only process repositories if provided
    if (settings.repositories && settings.repositories.length > 0) {
      const existingRepos = await db.repository.findMany({
        where: { workspaceId: workspace.id },
      });

      const incomingRepos = settings.repositories;
      const existingRepoIds = existingRepos.map((r) => r.id);
      const incomingRepoIds = incomingRepos.filter((r) => r.id).map((r) => r.id!);

      reposToCreate = incomingRepos.filter((r) => !r.id);
      if (reposToCreate.length > 0) {
        await db.repository.createMany({
          data: reposToCreate.map((repo) => ({
            workspaceId: workspace.id,
            repositoryUrl: repo.repositoryUrl,
            branch: repo.branch,
            name: repo.name,
            codeIngestionEnabled: repo.codeIngestionEnabled ?? true,
            docsEnabled: repo.docsEnabled ?? true,
            mocksEnabled: repo.mocksEnabled ?? true,
            embeddingsEnabled: repo.embeddingsEnabled ?? true,
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
            codeIngestionEnabled: repo.codeIngestionEnabled,
            docsEnabled: repo.docsEnabled,
            mocksEnabled: repo.mocksEnabled,
            embeddingsEnabled: repo.embeddingsEnabled,
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

    // Get all repo names for pm2 generation (needed for multi-repo cwd resolution)
    const allRepos = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, repositoryUrl: true, branch: true, name: true, codeIngestionEnabled: true },
      orderBy: { createdAt: "asc" },
    });
    const repoNames = allRepos.map((r) => extractRepoName(r.repositoryUrl));
    // Fallback to incoming repos if no repos in DB yet
    if (repoNames.length === 0 && settings.repositories) {
      repoNames.push(...settings.repositories.map((r) => extractRepoName(r.repositoryUrl)));
    }

    // Get global env vars for PM2 config generation
    const globalEnvVars = Array.isArray(settings.environmentVariables)
      ? (settings.environmentVariables as Array<{ name: string; value: string }>)
      : undefined;

    // Check if infrastructure-affecting fields have changed BEFORE syncPM2AndServices modifies containerFiles
    // If repositories not provided in settings, use existing repos (don't treat as removal)
    const incomingRepos = settings.repositories ?? allRepos;
    // Decrypt existing env vars so the comparison is plain text vs plain text
    // (existingSwarm.environmentVariables is encrypted in the DB)
    const existingForComparison = existingSwarm
      ? {
          ...existingSwarm,
          environmentVariables: decryptStoredEnvVars(existingSwarm.environmentVariables),
        }
      : null;
    const infraChanged = hasInfrastructureChange(
      settings,
      existingForComparison,
      incomingRepos,
      allRepos,
    );

    // Perform bidirectional sync for services/containerFiles
    const syncResult = syncPM2AndServices(
      (existingSwarm?.services as unknown as SwarmServiceConfig[]) || [],
      (existingSwarm?.containerFiles as unknown as Record<string, string>) || {},
      settings.services as SwarmServiceConfig[] | undefined,
      settings.containerFiles,
      repoNames,
      globalEnvVars,
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
      description: settings.description,
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

    // Migrate environment variables from JSON field to new table
    if (settings.environmentVariables) {
      await migrateEnvironmentVariablesToTable(swarm.id, settings.environmentVariables);
    }

    // Save service-specific env vars from services array (UI path)
    const hasIncomingServices = settings.services && settings.services.length > 0;
    if (hasIncomingServices) {
      await saveServiceEnvironmentVariables(swarm.id, settings.services as ServiceDataConfig[]);
      console.log(`[Stakgraph PUT] Saved service-specific env vars from services array for ${settings.services!.length} services`);
    }

    // Extract and save service-specific env vars from PM2 config
    // Only do this when pm2.config.js is explicitly sent WITHOUT services
    // (i.e., an external update, not UI-regenerated pm2 config)
    const hasIncomingPM2 = settings.containerFiles?.["pm2.config.js"];

    if (hasIncomingPM2 && !hasIncomingServices) {
      try {
        const pm2Content = Buffer.from(settings.containerFiles!["pm2.config.js"], "base64").toString("utf-8");
        const envVarsPerService = extractEnvVarsFromPM2Config(pm2Content);

        // Convert Map<serviceName, envVars[]> to ServiceDataConfig[] for reuse
        const servicesFromPM2: ServiceDataConfig[] = Array.from(envVarsPerService.entries()).map(
          ([serviceName, envVars]) => ({
            name: serviceName,
            port: 0,
            scripts: { start: "" },
            env: Object.fromEntries(envVars.map((ev) => [ev.name, ev.value])),
          }),
        );

        await saveServiceEnvironmentVariables(swarm.id, servicesFromPM2);
        console.log(`[Stakgraph] Saved service-specific env vars from PM2 config for ${envVarsPerService.size} services`);
      } catch (error) {
        console.warn("[Stakgraph] Failed to extract env vars from PM2 config:", error);
      }
    }

    let swarmPoolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    if (!swarmPoolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      swarmPoolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }

    // Setup GitHub webhooks for all repos with code ingestion enabled (session auth only)
    if (!isApiTokenAuth && userId) {
      const callbackUrl = getGithubWebhookCallbackUrl(workspace.id, request);
      const webhookService = new WebhookService(getServiceConfig("github"));
      const reposForWebhook = allRepos.filter((r) => r.codeIngestionEnabled);

      await Promise.all(
        reposForWebhook.map(async (repo) => {
          try {
            const { defaultBranch } = await webhookService.setupRepositoryWithWebhook({
              userId,
              workspaceId: workspace.id,
              repositoryUrl: repo.repositoryUrl,
              callbackUrl,
              repositoryName: repo.name,
            });

            if (defaultBranch && defaultBranch !== repo.branch) {
              console.log(`[Stakgraph] Updating ${repo.name} branch to detected default: ${defaultBranch}`);
              await db.repository.update({
                where: { id: repo.id },
                data: { branch: defaultBranch },
              });
            }
          } catch (err) {
            console.error(`Failed to setup webhook for ${repo.name}:`, err);
          }
        }),
      );
    }

    // Use merged values for pool name check (convert null to undefined)
    // Fall back to swarm.id for consistency with other code paths (stakwork-run, task-workflow, chat/message)
    const mergedPoolName = settings.poolName ?? existingSwarm?.poolName ?? swarm?.id ?? undefined;
    const mergedPoolCpu = settings.poolCpu ?? existingSwarm?.poolCpu ?? undefined;
    const mergedPoolMemory = settings.poolMemory ?? existingSwarm?.poolMemory ?? undefined;

    // After updating/creating the swarm, sync settings to Pool Manager
    // Only trigger sync if infrastructure fields actually changed (not just metadata like description)
    console.log(`[Stakgraph PUT] infraChanged=${infraChanged} for ${slug}`);
    if (mergedPoolName && swarmPoolApiKey && swarm && infraChanged) {
      const syncResult2 = await syncPoolManagerSettings({
        workspaceId: workspace.id,
        workspaceSlug: slug,
        swarmId: swarm.id,
        poolApiKey: swarmPoolApiKey,
        poolCpu: mergedPoolCpu,
        poolMemory: mergedPoolMemory,
        userId: userId || undefined,
      });

      if (!syncResult2.success) {
        console.error("Failed to sync settings to Pool Manager:", syncResult2.error);
      }
    }

    // Set pending repair trigger if new repositories were added
    if (reposToCreate.length > 0) {
      const repoNames = reposToCreate.map((r) => r.name).join(", ");
      const primaryNewRepo = reposToCreate[0];

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          pendingRepairTrigger: {
            repoUrl: primaryNewRepo.repositoryUrl,
            repoName: repoNames,
            requestedAt: new Date().toISOString(),
          },
          podState: PodState.NOT_STARTED,
        },
      });

      console.log(`[Stakgraph] Set pending repair trigger for ${slug}: ${repoNames}`);
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
        codeIngestionEnabled: true,
        docsEnabled: true,
        mocksEnabled: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      message: "Pool settings saved successfully",
      data: {
        id: typedSwarm.id,
        name: typedSwarm.name || "",
        description: typedSwarm.description || "",
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
