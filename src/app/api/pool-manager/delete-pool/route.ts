import { NextRequest, NextResponse } from "next/server";
import { poolManagerService } from "@/lib/service-factory";
import { type ApiError } from "@/types";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

/**
 * DELETE /api/pool-manager/delete-pool
 * 
 * Deletes a pool from Pool Manager with proper authorization checks.
 * 
 * Authorization:
 * - User must be authenticated
 * - User must be a workspace owner or member
 * - User must have OWNER or ADMIN role
 * 
 * Security:
 * - Validates pool ownership through Swarm → Workspace relationship
 * - Enforces role-based access control
 * - Returns 404 if pool not found or not associated with workspace
 * - Returns 403 if user lacks required permissions
 */
export async function DELETE(request: NextRequest) {
  try {
    // 1. Authenticate user via middleware context
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }

    const userId = userOrResponse.id;

    // 2. Parse and validate request body
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    // 3. CRITICAL: Validate pool ownership through Swarm → Workspace relationship
    const swarm = await db.swarm.findFirst({
      where: { poolName: name },
      select: {
        id: true,
        poolName: true,
        workspace: {
          select: {
            id: true,
            slug: true,
            name: true,
            ownerId: true,
            members: {
              where: { userId, leftAt: null },
              select: { role: true }
            }
          }
        }
      }
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "Pool not found or not associated with any workspace" },
        { status: 404 }
      );
    }

    // 4. Verify user has access to the workspace
    const isOwner = swarm.workspace.ownerId === userId;
    const isMember = swarm.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied: You must be a workspace member to delete this pool" },
        { status: 403 }
      );
    }

    // 5. Enforce role-based access control - only OWNER and ADMIN can delete pools
    const hasAdminRole = isOwner || swarm.workspace.members.some(m => 
      m.role === "ADMIN" || m.role === "OWNER"
    );

    if (!hasAdminRole) {
      return NextResponse.json(
        { error: "Access denied: Only workspace owners and admins can delete pools" },
        { status: 403 }
      );
    }

    // 6. Proceed with pool deletion
    console.log(`Deleting pool ${name} for workspace ${swarm.workspace.slug} by user ${userId}`);
    
    const pool = await poolManagerService().deletePool({ name });

    return NextResponse.json(
      { 
        pool,
        message: `Pool ${name} successfully deleted from workspace ${swarm.workspace.name}`
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting Pool Manager pool:", error);
    
    // Handle Pool Manager API errors
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status }
      );
    }

    // Handle unexpected errors
    return NextResponse.json(
      { error: "Failed to delete pool" },
      { status: 500 }
    );
  }
}
