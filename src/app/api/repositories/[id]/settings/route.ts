import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";
import { getSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

// Validation schema for repository sync settings
const repositorySettingsSchema = z.object({
  codeIngestionEnabled: z.boolean().optional(),
  docsEnabled: z.boolean().optional(),
  mocksEnabled: z.boolean().optional(),
  embeddingsEnabled: z.boolean().optional(),
  triggerPodRepair: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
          error: "UNAUTHORIZED",
        },
        { status: 401 }
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
        { status: 401 }
      );
    }

    // Find repository and verify user has access via workspace membership
    const repository = await db.repository.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!repository) {
      return NextResponse.json(
        {
          success: false,
          message: "Repository not found",
          error: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    // Check if user is a member of the workspace
    if (repository.workspace.members.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "You don't have access to this repository",
          error: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = repositorySettingsSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation failed",
          error: "VALIDATION_ERROR",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const settings = validationResult.data;

    // Capture existing value to detect change
    const previousTriggerPodRepair = repository.triggerPodRepair;

    // Update repository settings
    const updatedRepository = await db.repository.update({
      where: { id },
      data: {
        ...(settings.codeIngestionEnabled !== undefined && {
          codeIngestionEnabled: settings.codeIngestionEnabled,
        }),
        ...(settings.docsEnabled !== undefined && {
          docsEnabled: settings.docsEnabled,
        }),
        ...(settings.mocksEnabled !== undefined && {
          mocksEnabled: settings.mocksEnabled,
        }),
        ...(settings.embeddingsEnabled !== undefined && {
          embeddingsEnabled: settings.embeddingsEnabled,
        }),
        ...(settings.triggerPodRepair !== undefined && {
          triggerPodRepair: settings.triggerPodRepair,
        }),
      },
      select: {
        id: true,
        name: true,
        repositoryUrl: true,
        branch: true,
        codeIngestionEnabled: true,
        docsEnabled: true,
        mocksEnabled: true,
        embeddingsEnabled: true,
        triggerPodRepair: true,
      },
    });

    // Best-effort pool manager sync when triggerPodRepair changes
    const triggerPodRepairChanged =
      settings.triggerPodRepair !== undefined &&
      settings.triggerPodRepair !== previousTriggerPodRepair;

    if (triggerPodRepairChanged) {
      try {
        const swarm = await db.swarm.findUnique({
          where: { workspaceId: repository.workspace.id },
          select: { id: true, poolName: true, poolCpu: true, poolMemory: true },
        });

        if (swarm?.poolName) {
          const poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
          if (poolApiKey) {
            const syncResult = await syncPoolManagerSettings({
              workspaceId: repository.workspace.id,
              workspaceSlug: repository.workspace.slug,
              swarmId: swarm.id,
              poolApiKey,
              poolCpu: swarm.poolCpu ?? undefined,
              poolMemory: swarm.poolMemory ?? undefined,
            });
            if (!syncResult.success) {
              console.error(
                `[PoolManagerSync] Failed to sync after triggerPodRepair change for repo ${id}:`,
                syncResult.error
              );
            }
          } else {
            console.warn(
              `[PoolManagerSync] No pool API key found for workspace ${repository.workspace.id}, skipping sync`
            );
          }
        } else {
          console.warn(
            `[PoolManagerSync] No active swarm/poolName for workspace ${repository.workspace.id}, skipping sync`
          );
        }
      } catch (syncError) {
        console.error(
          `[PoolManagerSync] Unexpected error syncing pool manager for repo ${id}:`,
          syncError
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Repository settings updated successfully",
      data: updatedRepository,
    });
  } catch (error) {
    console.error("Error updating repository settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to update repository settings",
        error: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch current settings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
          error: "UNAUTHORIZED",
        },
        { status: 401 }
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
        { status: 401 }
      );
    }

    // Find repository and verify user has access
    const repository = await db.repository.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!repository) {
      return NextResponse.json(
        {
          success: false,
          message: "Repository not found",
          error: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    if (repository.workspace.members.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "You don't have access to this repository",
          error: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: repository.id,
        name: repository.name,
        repositoryUrl: repository.repositoryUrl,
        branch: repository.branch,
        codeIngestionEnabled: repository.codeIngestionEnabled,
        docsEnabled: repository.docsEnabled,
        mocksEnabled: repository.mocksEnabled,
        embeddingsEnabled: repository.embeddingsEnabled,
        triggerPodRepair: repository.triggerPodRepair,
      },
    });
  } catch (error) {
    console.error("Error fetching repository settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch repository settings",
        error: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
