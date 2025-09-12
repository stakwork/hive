import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { config } from "@/lib/env";
import { PoolManagerService } from "@/services/pool-manager";
import { saveOrUpdateSwarm, select as swarmSelect } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { getWorkspaceBySlug } from "@/services/workspace";
import { ServiceConfig } from "@/types";
import type { SwarmSelectResult } from "@/types/swarm";
import { getDevContainerFilesFromBase64 } from "@/utils/devContainerUtils";
import { SwarmStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { WebhookService } from "@/services/github/WebhookService";
import { getServiceConfig } from "@/config/services";
import { getGithubWebhookCallbackUrl } from "@/lib/url";

import { z } from "zod";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Validation schema for stakgraph settings
const stakgraphSettingsSchema = z.object({
  name: z.string().min(1, "Name is required"),
  repositoryUrl: z.string().url("Invalid repository URL"),
  swarmUrl: z.string().url("Invalid swarm URL"),
  swarmSecretAlias: z.string().min(1, "Swarm API key is required"),
  swarmApiKey: z.string().optional(),
  poolName: z.string().min(1, "Pool name is required"),
  poolCpu: z.string().optional(),
  poolMemory: z.string().optional(),
  description: z.string().optional(),
  containerFiles: z.record(z.string()).optional().default({}),
  environmentVariables: z
    .array(
      z.object({
        name: z.string().min(1, "Environment variable key is required"),
        value: z.string(),
      }),
    )
    .optional()
    .default([]),
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
        }),
        dev: z.boolean().optional(),
        env: z.record(z.string()).optional(),
        language: z.string().optional(),
        interpreter: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
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

    return NextResponse.json({
      success: true,
      message: "Stakgraph settings retrieved successfully",
      data: {
        name: swarm.name || "",
        description: swarm.repositoryDescription || "",
        repositoryUrl: swarm.repositoryUrl || "",
        swarmUrl: swarm.swarmUrl || "",
        swarmSecretAlias: swarm.swarmSecretAlias || "",
        poolName: swarm.id || "",
        poolCpu: swarm.poolCpu || "2",
        poolMemory: swarm.poolMemory || "4Gi",
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
        webhookEnsured: await (async () => {
          if (!swarm.repositoryUrl) return false;
          const repo = await db.repository.findFirst({
            where: {
              repositoryUrl: swarm.repositoryUrl,
              workspaceId: swarm.workspaceId,
            },
            select: { githubWebhookId: true, githubWebhookSecret: true },
          });
          return Boolean(repo?.githubWebhookId && repo?.githubWebhookSecret);
        })(),
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

    await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: settings.name,
      repositoryName: settings.name,
      repositoryDescription: settings.description,
      repositoryUrl: settings.repositoryUrl,
      swarmUrl: settings.swarmUrl,
      status: SwarmStatus.ACTIVE, // auto active
      swarmSecretAlias: settings.swarmSecretAlias,
      swarmApiKey: settings.swarmApiKey,
      poolName: settings.poolName,
      poolCpu: settings.poolCpu,
      poolMemory: settings.poolMemory,
      services: settings.services,
      environmentVariables: settings.environmentVariables,
      containerFiles: settings.containerFiles,
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

    // Get pool API key from swarm instead of user
    let decryptedPoolApiKey: string;

    try {
      decryptedPoolApiKey = swarmPoolApiKey ? encryptionService.decryptField("poolApiKey", swarmPoolApiKey) : "";
    } catch (error) {
      console.error("Failed to decrypt poolApiKey:", error);
      decryptedPoolApiKey = swarmPoolApiKey;
    }

    try {
      const callbackUrl = getGithubWebhookCallbackUrl(request);
      const webhookService = new WebhookService(getServiceConfig("github"));

      const { defaultBranch } = await webhookService.setupRepositoryWithWebhook({
        userId,
        workspaceId: workspace.id,
        repositoryUrl: settings.repositoryUrl,
        callbackUrl,
        repositoryName: settings.name,
      });

      if (defaultBranch) {
        await db.swarm.update({
          where: { id: swarm.id },
          data: { defaultBranch },
        });
      }
    } catch (err) {
      console.error("Failed to setup repository with webhook:", err);
    }

    // After updating/creating the swarm, update environment variables in Pool Manager if poolName, poolApiKey, and environmentVariables are present
    if (settings.poolName && decryptedPoolApiKey && Array.isArray(settings.environmentVariables)) {
      try {
        const poolManager = new PoolManagerService(config as unknown as ServiceConfig);

        if (swarm) {
          const currentEnvVars = await poolManager.getPoolEnvVars(swarm.id, decryptedPoolApiKey);

          // TODO: This is a solution to preserve data structure.
          const files = getDevContainerFilesFromBase64(settings.containerFiles);

          const github_pat = await getGithubUsernameAndPAT(session?.user.id);
          await poolManager.updatePoolData(
            swarm.id,
            decryptedPoolApiKey,
            settings.environmentVariables as unknown as Array<{
              name: string;
              value: string;
            }>,
            currentEnvVars as unknown as Array<{
              name: string;
              value: string;
              masked?: boolean;
            }>,
            files,
            settings.poolCpu,
            settings.poolMemory,
            github_pat?.appAccessToken || github_pat?.pat || "",
            github_pat?.username || "",
          );
        }
      } catch (err) {
        console.error("Failed to update env vars in Pool Manager:", err);
      }
    }

    const typedSwarm = swarm as SwarmSelectResult & { poolApiKey?: string };
    return NextResponse.json({
      success: true,
      message: "Stakgraph settings saved successfully",
      data: {
        id: typedSwarm.id,
        name: typedSwarm.repositoryName,
        description: typedSwarm.repositoryDescription,
        repositoryUrl: typedSwarm.repositoryUrl,
        swarmUrl: typedSwarm.swarmUrl,
        poolName: typedSwarm.poolName,
        swarmSecretAlias: typedSwarm.swarmSecretAlias || "",
        services: typeof typedSwarm.services === "string" ? JSON.parse(typedSwarm.services) : typedSwarm.services || [],
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
