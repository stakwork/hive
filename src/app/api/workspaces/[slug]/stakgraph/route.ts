import { getServiceConfig } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { decryptEnvVars, encryptEnvVars, EncryptionService } from "@/lib/encryption";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
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
import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import {
  maskEnvMap,
  maskEnvVarList,
  unmaskEnvVarList,
  unmaskServiceEnvs,
  type EnvVar,
} from "@/lib/env-mask";
import { loadPoolRollout, type RolloutSwarmInput } from "@/lib/pods/rollout";

/** Fields that must never appear as values in audit logs. */
const AUDIT_SECRET_FIELDS = new Set(["environmentVariables", "swarmApiKey", "poolApiKey"]);

import type { ServiceDataConfig } from "@/components/stakgraph/types";

import { z } from "zod";

export const runtime = "nodejs";
// Bounds the background pool-manager push scheduled with after(); the PUT response is not delayed by it.
export const maxDuration = 300;

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

/** Decrypts one EnvironmentVariable table row value (stored as an encrypted JSON string). */
function decryptTableEnvValue(row: { name: string; value: string }): string {
  try {
    const decrypted = decryptEnvVars([{ name: row.name, value: JSON.parse(row.value) }]);
    return decrypted[0]?.value || "";
  } catch (error) {
    console.warn(`[Stakgraph] Failed to decrypt env var ${row.name}:`, error);
    // Fallback: try to use raw value if it's a string
    return typeof row.value === "string" ? row.value : "";
  }
}

/** Service-specific env vars (serviceName != "") grouped by service, decrypted. */
async function loadServiceEnvMap(swarmId: string): Promise<Record<string, Record<string, string>>> {
  const rows = await db.environmentVariable.findMany({
    where: { swarmId, serviceName: { not: "" } },
    select: { serviceName: true, name: true, value: true },
  });
  const map: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (!row.serviceName) continue;
    (map[row.serviceName] ??= {})[row.name] = decryptTableEnvValue(row);
  }
  return map;
}

/** Global env vars from the table (serviceName == ""), decrypted, as name -> value. */
async function loadGlobalTableEnv(swarmId: string): Promise<Record<string, string>> {
  const rows = await db.environmentVariable.findMany({
    where: { swarmId, serviceName: "" },
    select: { name: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.name, decryptTableEnvValue(r)]));
}

/** Stored global env values by name: the swarm JSON field wins, table rows fill the gaps. */
function storedGlobalEnv(jsonField: unknown, tableEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...tableEnv };
  const decrypted = decryptStoredEnvVars(jsonField);
  if (Array.isArray(decrypted)) {
    for (const v of decrypted as Array<{ name?: string; value?: unknown }>) {
      if (v?.name && typeof v.value === "string") out[v.name] = v.value;
    }
  }
  return out;
}

/** Run `fn` after the response is sent; falls back to a detached promise outside a request scope. */
function runInBackground(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    void fn();
  }
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
        triggerPodRepair: z.boolean().optional(),
        shallowClone: z.boolean().optional(),
        blobSizeLimit: z
          .string()
          .regex(/^[1-9][0-9]*[kmg]?$/i)
          .max(20)
          .or(z.literal(""))
          .optional(),
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
    const { slug } = await params;

    let workspaceId: string;
    // Token callers (org key / global API token) get env values masked; sessions get full values.
    let isTokenCaller = false;

    if (request.headers.get("x-api-token")) {
      const caller = await resolvePodCaller(request, { slug });
      if (caller instanceof NextResponse) return caller;
      workspaceId = caller.workspaceId;
      isTokenCaller = caller.kind !== "user";
    } else {
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

      const isSuperAdmin = await checkIsSuperAdmin(userId);
      const workspace = await getWorkspaceBySlug(slug, userId, { isSuperAdmin });
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
      workspaceId = workspace.id;

      // Audit log when access was granted via super-admin bypass (non-member super admin)
      if (isSuperAdmin && workspace.userRole === "OWNER") {
        const isMemberOwner = workspace.owner?.id === userId;
        if (!isMemberOwner) {
          console.log(
            JSON.stringify({
              event: "superadmin_bypass_read",
              endpoint: "GET /api/workspaces/[slug]/stakgraph",
              userId,
              workspaceSlug: slug,
            }),
          );
        }
      }
    }

    const swarm = (await db.swarm.findUnique({
      where: { workspaceId },
      select: swarmSelect,
    })) as (SwarmSelectResult & RolloutSwarmInput) | null;

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

    const serviceEnvMap = await loadServiceEnvMap(swarm.id);

    const repositories = await db.repository.findMany({
      where: { workspaceId },
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

    const rollout = await loadPoolRollout(db, swarm);

    const decryptedEnv = decryptStoredEnvVars(environmentVariables);
    const services = parseSwarmServices(swarm.services, serviceEnvMap);

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
        environmentVariables:
          isTokenCaller && Array.isArray(decryptedEnv)
            ? maskEnvVarList(decryptedEnv as EnvVar[])
            : decryptedEnv,
        services: isTokenCaller ? services.map((sv) => ({ ...sv, env: maskEnvMap(sv.env) })) : services,
        status: swarm.status,
        lastUpdated: swarm.updatedAt,
        containerFiles: swarm.containerFiles || {},
        webhookEnsured: repositories.length > 0
          && Boolean(repositories[0].githubWebhookId && repositories[0].githubWebhookSecret),
        rollout,
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

    // Token auth (global API_TOKEN or `hiveorg_` org key) — no user session needed.
    // Anything without an x-api-token header goes through the session path unchanged.
    let tokenCaller: Awaited<ReturnType<typeof resolvePodCaller>> | null = null;
    if (request.headers.get("x-api-token")) {
      tokenCaller = await resolvePodCaller(request, { slug });
      if (tokenCaller instanceof NextResponse) return tokenCaller;
    }
    const isApiTokenAuth = tokenCaller !== null && tokenCaller.kind !== "user";

    let workspace: { id: string; userRole?: string } | null = null;
    let userId: string | null = null;
    // Populated in the session-auth branch; tracks bypass state for downstream guards.
    let sessionAuthMeta: { isSuperAdmin: boolean; userRole: string | null } = {
      isSuperAdmin: false,
      userRole: null,
    };

    if (tokenCaller) {
      workspace = { id: tokenCaller.workspaceId };
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

      const isSuperAdmin = await checkIsSuperAdmin(userId);
      workspace = await getWorkspaceBySlug(slug, userId, { isSuperAdmin });
      // Capture bypass/role info for use in downstream guards (no extra DB query)
      sessionAuthMeta = { isSuperAdmin, userRole: workspace?.userRole ?? null };
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

    // IDOR fix: only OWNER or ADMIN members (and super-admins, who receive OWNER role)
    // may write pod CPU/RAM, env vars, and swarm config. Lower roles (e.g. VIEWER,
    // DEVELOPER) are rejected here even though getWorkspaceBySlug returns them.
    if (!isApiTokenAuth) {
      const { userRole } = sessionAuthMeta;
      if (userRole !== "OWNER" && userRole !== "ADMIN") {
        return NextResponse.json(
          {
            success: false,
            message: "Forbidden: insufficient role",
            error: "FORBIDDEN",
          },
          { status: 403 },
        );
      }
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

    // Capture pre-mutation repo state for infrastructure change detection.
    // Must be fetched BEFORE any DB writes so hasInfrastructureChange can compare
    // the true existing state against the incoming repos (not the post-mutation state).
    const reposBeforeUpdate = await db.repository.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, repositoryUrl: true, branch: true, name: true, codeIngestionEnabled: true },
      orderBy: { createdAt: "asc" },
    });

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
      triggerPodRepair?: boolean;
      shallowClone?: boolean;
      blobSizeLimit?: string | null;
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
            mocksEnabled: repo.mocksEnabled ?? false,
            embeddingsEnabled: repo.embeddingsEnabled ?? true,
            triggerPodRepair: repo.triggerPodRepair ?? false,
            shallowClone: repo.shallowClone ?? false,
            blobSizeLimit: repo.blobSizeLimit === "" ? null : (repo.blobSizeLimit ?? null),
          })),
        });
      }

      const reposToUpdate = incomingRepos.filter(
        (r) => r.id && existingRepoIds.includes(r.id),
      );
      for (const repo of reposToUpdate) {
        await db.repository.update({
          where: { id: repo.id, workspaceId: workspace.id },
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
        // Best-effort cleanup before deleting DB rows. Failures (expired token,
        // repo gone, swarm offline, etc.) are logged but don't block DB cleanup.
        const reposBeingDeleted = await db.repository.findMany({
          where: {
            id: { in: repoIdsToDelete },
            workspaceId: workspace.id,
          },
          select: { repositoryUrl: true, githubWebhookId: true },
        });

        // 1) Delete GitHub webhooks
        const reposWithWebhook = reposBeingDeleted.filter((r) => r.githubWebhookId);
        if (reposWithWebhook.length > 0 && userId) {
          const webhookService = new WebhookService(getServiceConfig("github"));
          await Promise.all(
            reposWithWebhook.map((repo) =>
              webhookService
                .deleteRepoWebhook({
                  userId,
                  repositoryUrl: repo.repositoryUrl,
                  workspaceId: workspace.id,
                })
                .catch((error) => {
                  console.error(
                    `[STAKGRAPH] Failed to delete GitHub webhook for ${repo.repositoryUrl}:`,
                    error,
                  );
                }),
            ),
          );
        }

        // 2) Delete the repo from stakgraph (port 3355) so it stops indexing it.
        if (reposBeingDeleted.length > 0) {
          const swarmForDelete = await db.swarm.findUnique({
            where: { workspaceId: workspace.id },
            select: { swarmUrl: true, swarmApiKey: true },
          });
          if (swarmForDelete?.swarmUrl && swarmForDelete.swarmApiKey) {
            const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarmForDelete.swarmUrl);
            const apiKey = EncryptionService.getInstance().decryptField(
              "swarmApiKey",
              swarmForDelete.swarmApiKey,
            );
            await Promise.all(
              reposBeingDeleted.map(async (repo) => {
                try {
                  const url = `${repo2GraphUrl}/repo?repo_url=${encodeURIComponent(repo.repositoryUrl)}`;
                  const res = await fetch(url, {
                    method: "DELETE",
                    headers: {
                      Authorization: `Bearer ${apiKey}`,
                      "x-api-token": apiKey,
                    },
                  });
                  if (!res.ok) {
                    console.error(
                      `[STAKGRAPH] Failed to delete repo from stakgraph ${repo.repositoryUrl}: HTTP ${res.status}`,
                    );
                  }
                } catch (error) {
                  console.error(
                    `[STAKGRAPH] Error deleting repo from stakgraph ${repo.repositoryUrl}:`,
                    error,
                  );
                }
              }),
            );
          }
        }

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
        id: true,
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

    // Token callers read env values masked. Restore stored values for any entry sent back
    // unchanged, before anything else (infra diff, pm2 regeneration, DB writes) sees it.
    if (isApiTokenAuth && existingSwarm) {
      if (settings.environmentVariables) {
        const stored = storedGlobalEnv(existingSwarm.environmentVariables, await loadGlobalTableEnv(existingSwarm.id));
        settings.environmentVariables = unmaskEnvVarList(settings.environmentVariables, stored);
      }
      if (settings.services) {
        settings.services = unmaskServiceEnvs(settings.services, await loadServiceEnvMap(existingSwarm.id));
      }
    }

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
      reposBeforeUpdate,
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

    // Setup GitHub webhooks for all repos with code ingestion enabled.
    // Skip when: (a) API-token auth, or (b) access was granted via the super-admin bypass —
    // a non-member super admin's GitHub credentials are not valid for the target repos.
    const accessViaBypass = sessionAuthMeta.isSuperAdmin && !isApiTokenAuth;
    if (!isApiTokenAuth && !accessViaBypass && userId) {
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

    // Audit log: emit a structured line whenever this write was made via a privileged path.
    if (accessViaBypass && userId) {
      const changedFields = Object.keys(settings).filter((k) => !AUDIT_SECRET_FIELDS.has(k));
      const secretFieldsChanged = Object.keys(settings).filter((k) => AUDIT_SECRET_FIELDS.has(k));
      console.log(
        JSON.stringify({
          event: "superadmin_bypass_write",
          endpoint: "PUT /api/workspaces/[slug]/stakgraph",
          userId,
          workspaceSlug: slug,
          changedFields,
          secretFieldsChangedNames: secretFieldsChanged,
        }),
      );
    } else if (isApiTokenAuth) {
      const changedFields = Object.keys(settings).filter((k) => !AUDIT_SECRET_FIELDS.has(k));
      const secretFieldsChanged = Object.keys(settings).filter((k) => AUDIT_SECRET_FIELDS.has(k));
      console.log(
        JSON.stringify({
          event: "api_token_write",
          endpoint: "PUT /api/workspaces/[slug]/stakgraph",
          actor: tokenCaller?.kind === "org" ? "org-key" : "api-token",
          ...(tokenCaller?.kind === "org" ? { apiKeyId: tokenCaller.apiKeyId } : {}),
          workspaceSlug: slug,
          changedFields,
          secretFieldsChangedNames: secretFieldsChanged,
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
    let changeId: string | null = null;
    const requestedAt = new Date();
    if (mergedPoolName && swarmPoolApiKey && swarm && infraChanged) {
      const id = randomUUID();
      changeId = id;
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolChangeId: id, poolChangeRequestedAt: requestedAt, poolPushedAt: null, poolPushError: null },
      });

      const pushParams = {
        workspaceId: workspace.id,
        workspaceSlug: slug,
        swarmId: swarm.id,
        poolApiKey: swarmPoolApiKey,
        poolCpu: mergedPoolCpu,
        poolMemory: mergedPoolMemory,
      };
      const swarmId = swarm.id;
      runInBackground(async () => {
        let update: { poolPushedAt: Date } | { poolPushError: string };
        try {
          const result = await syncPoolManagerSettings(pushParams);
          if (result.success) {
            update = { poolPushedAt: new Date() };
          } else {
            console.error("Failed to sync settings to Pool Manager:", result.error);
            update = { poolPushError: result.error || "Pool manager sync failed" };
          }
        } catch (error) {
          console.error("Failed to sync settings to Pool Manager:", error);
          update = { poolPushError: error instanceof Error ? error.message : String(error) };
        }
        try {
          // Only touch the row if no newer PUT has replaced this change
          await db.swarm.updateMany({ where: { id: swarmId, poolChangeId: id }, data: update });
        } catch (error) {
          console.error("Failed to record pool push result:", error);
        }
      });
    }

    // Set pending repair trigger only for new repositories that explicitly opt in
    const reposRequestingRepair = reposToCreate.filter((r) => r.triggerPodRepair === true);
    if (reposRequestingRepair.length > 0) {
      const repoNames = reposRequestingRepair.map((r) => r.name).join(", ");
      const primaryNewRepo = reposRequestingRepair[0];

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
      changeId,
      requestedAt: requestedAt.toISOString(),
      infraChanged,
      rollout: { state: changeId ? "pushing" : "idle" },
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
