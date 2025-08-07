import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { PoolManagerService } from "@/services/pool-manager";
import { saveOrUpdateSwarm, select as swarmSelect } from "@/services/swarm/db";
import { getWorkspaceBySlug } from "@/services/workspace";
import { ServiceConfig } from "@/types";
import type { SwarmSelectResult } from "@/types/swarm";
import { getDevContainerFilesFromBase64 } from "@/utils/devContainerUtils";
import { SwarmStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Validation schema for stakgraph settings
const stakgraphSettingsSchema = z.object({
  name: z.string().min(1, "Name is required"),
  repositoryUrl: z.string().url("Invalid repository URL"),
  swarmUrl: z.string().url("Invalid swarm URL"),
  swarmSecretAlias: z.string().min(1, "Swarm API key is required"),
  poolName: z.string().min(1, "Pool name is required"),
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
          preStart: z.string().optional(),
          postStart: z.string().optional(),
        }),
        // Add optional fields that might be in your payload
        dev: z.boolean().optional(),
        env: z.record(z.string()).optional(),
        language: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
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

    // Get workspace and verify access
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

    // Get the swarm associated with this workspace
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

    // Fetch environment variables from Pool Manager using poolName and poolApiKey
    const environmentVariables = swarm?.environmentVariables;

    console.log(">>>>>>>>>swarm.services", swarm);

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
        environmentVariables:
          typeof environmentVariables === "string"
            ? JSON.parse(environmentVariables)
            : environmentVariables,
        services:
          typeof swarm.services === "string"
            ? JSON.parse(swarm.services)
            : swarm.services || [],
        status: swarm.status,
        lastUpdated: swarm.updatedAt,
        containerFiles: swarm.containerFiles || [],
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
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

    // Get workspace and verify access
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

    // Parse and validate request body
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

    // Save or update Swarm using shared service
    const swarm = await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: settings.name,
      repositoryName: settings.name,
      repositoryDescription: settings.description,
      repositoryUrl: settings.repositoryUrl,
      swarmUrl: settings.swarmUrl,
      status: SwarmStatus.ACTIVE, // auto active
      swarmSecretAlias: settings.swarmSecretAlias,
      poolName: settings.poolName,
      services: settings.services,
      environmentVariables: settings.environmentVariables,
      containerFiles: settings.containerFiles,
    });

    const user = await db.user.findUnique({
      where: {
        email: session?.user?.email || "",
      },
    });

    const poolApiKey = user?.poolApiKey;

    console.log(">>>>>>>>>settings.services", settings.services);

    // After updating/creating the swarm, update environment variables in Pool Manager if poolName, poolApiKey, and environmentVariables are present
    if (
      settings.poolName &&
      poolApiKey &&
      Array.isArray(settings.environmentVariables)
    ) {
      try {
        const poolManager = new PoolManagerService(
          config as unknown as ServiceConfig,
        );

        const swarm = (await db.swarm.findUnique({
          where: { workspaceId: workspace.id },
          select: swarmSelect,
        })) as SwarmSelectResult | null;

        if (swarm) {
          const currentEnvVars = await poolManager.getPoolEnvVars(
            swarm.id,
            poolApiKey,
          );

          // TODO: This is a solution to preserve data structure.
          const files = getDevContainerFilesFromBase64(settings.containerFiles);

          // Always send all vars, with correct masked/changed status
          await poolManager.updatePoolData(
            swarm.id,
            poolApiKey,
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
          );
        }
      } catch (err) {
        console.error("Failed to update env vars in Pool Manager:", err);
        // Optionally, return error or continue
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
        poolApiKey: typedSwarm.poolApiKey || "",
        swarmSecretAlias: typedSwarm.swarmSecretAlias || "",
        services:
          typeof typedSwarm.services === "string"
            ? JSON.parse(typedSwarm.services)
            : typedSwarm.services || [],
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
