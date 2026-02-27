import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { config, isSuperAdmin } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    const { db } = await import("@/lib/db");

    // Get GitHub username to check superadmin status
    const githubAuth = await db.gitHubAuth.findUnique({
      where: { userId: userOrResponse.id },
    });

    const superAdmin = isSuperAdmin(githubAuth?.githubUsername ?? "");

    // Get swarm config
    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
      select: { minimumVms: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        minimumVms: swarm?.minimumVms ?? 2,
        isSuperAdmin: superAdmin,
      },
    });
  } catch (error) {
    console.error("Error in pool config GET endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    const { db } = await import("@/lib/db");

    // Get GitHub username to check superadmin status
    const githubAuth = await db.gitHubAuth.findUnique({
      where: { userId: userOrResponse.id },
    });

    const githubUsername = githubAuth?.githubUsername ?? "";

    // Check if user is superadmin
    if (!isSuperAdmin(githubUsername)) {
      return NextResponse.json(
        { success: false, message: "Forbidden: Superadmin access required" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { minimumVms } = body;

    // Validate minimumVms
    if (typeof minimumVms !== "number" || minimumVms < 1) {
      return NextResponse.json(
        { success: false, message: "Invalid minimumVms: must be a number >= 1" },
        { status: 400 }
      );
    }

    // Get swarm including pool details
    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        poolName: true,
        poolApiKey: true,
      },
    });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    if (!swarm.poolName || !swarm.poolApiKey) {
      return NextResponse.json(
        { success: false, message: "Pool configuration incomplete" },
        { status: 400 }
      );
    }

    // Update DB
    await db.swarm.update({
      where: { id: swarm.id },
      data: { minimumVms },
    });

    // Forward to Pool Manager
    try {
      const decryptedApiKey = encryptionService.decryptField("poolApiKey", swarm.poolApiKey);
      const poolManagerUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(swarm.poolName)}`;

      const response = await fetch(poolManagerUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${decryptedApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ minimum_vms: minimumVms }),
      });

      if (!response.ok) {
        console.error(`Pool Manager update failed: ${response.status}`);
        // Don't fail the request - DB update succeeded
      }
    } catch (error) {
      console.error("Failed to update Pool Manager:", error);
      // Don't fail the request - DB update succeeded
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error in pool config PATCH endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
