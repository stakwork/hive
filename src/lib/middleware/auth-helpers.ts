import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { MiddlewareContext, MiddlewareUser } from "@/types/middleware";
import { unauthorizedError } from "@/types/errors";
import { requireAuth } from "./utils";

interface AuthResult {
  userId: string;
  email: string;
  name: string;
}

interface WorkspaceResolutionParams {
  workspaceId?: string;
  featureId?: string;
  taskId?: string;
}

/**
 * Resolves workspace and owner information from various IDs
 */
async function resolveWorkspaceOwner(
  params: WorkspaceResolutionParams
): Promise<{ ownerId: string; ownerEmail: string; ownerName: string } | null> {
  const { workspaceId, featureId, taskId } = params;

  if (workspaceId) {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId, deleted: false },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!workspace) return null;

    return {
      ownerId: workspace.owner.id,
      ownerEmail: workspace.owner.email!,
      ownerName: workspace.owner.name!,
    };
  }

  if (featureId) {
    const feature = await db.feature.findUnique({
      where: { id: featureId, deleted: false },
      include: {
        workspace: {
          include: {
            owner: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!feature) return null;

    return {
      ownerId: feature.workspace.owner.id,
      ownerEmail: feature.workspace.owner.email!,
      ownerName: feature.workspace.owner.name!,
    };
  }

  if (taskId) {
    const task = await db.task.findFirst({
      where: { id: taskId, deleted: false },
      include: {
        workspace: {
          include: {
            owner: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!task) return null;

    return {
      ownerId: task.workspace.owner.id,
      ownerEmail: task.workspace.owner.email!,
      ownerName: task.workspace.owner.name!,
    };
  }

  return null;
}

/**
 * Requires authentication via either NextAuth session or API_TOKEN
 * When API_TOKEN is used, resolves userId from workspace owner
 *
 * @param request - The Next.js request object
 * @param context - Middleware context from getMiddlewareContext()
 * @param resolutionParams - IDs to resolve workspace owner (workspaceId, featureId, or taskId)
 * @returns AuthResult with userId, email, name or NextResponse with error
 */
export async function requireAuthWithApiToken(
  request: NextRequest,
  context: MiddlewareContext,
  resolutionParams: WorkspaceResolutionParams = {}
): Promise<AuthResult | NextResponse> {
  // Check if middleware validated API_TOKEN
  if (context.authStatus === "api_token") {
    // Middleware already validated the token, now resolve workspace owner
    const ownerInfo = await resolveWorkspaceOwner(resolutionParams);

    if (!ownerInfo) {
      return NextResponse.json(
        { error: "Workspace not found or invalid resource ID" },
        { status: 404 }
      );
    }

    return {
      userId: ownerInfo.ownerId,
      email: ownerInfo.ownerEmail,
      name: ownerInfo.ownerName,
    };
  }

  // Fall back to NextAuth session authentication
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) {
    return userOrResponse;
  }

  return {
    userId: userOrResponse.id,
    email: userOrResponse.email,
    name: userOrResponse.name,
  };
}
