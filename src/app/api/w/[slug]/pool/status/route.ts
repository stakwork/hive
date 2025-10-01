import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServiceConfig } from "@/config/services";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Get swarm data directly from database
    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        poolApiKey: true,
      },
    });

    if (!swarm?.id || !swarm?.poolApiKey) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    const config = getServiceConfig("poolManager");
    const url = `${config.baseURL}/pools/${swarm.id}`;

    const decryptedApiKey = encryptionService.decryptField("poolApiKey", swarm.poolApiKey);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${decryptedApiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Pool status fetch failed:", errorText);
      return NextResponse.json(
        {
          success: false,
          message: `Failed to fetch pool status: ${response.statusText}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      data: {
        status: {
          runningVms: data.status.running_vms,
          pendingVms: data.status.pending_vms,
          failedVms: data.status.failed_vms,
          lastCheck: data.status.last_check,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching pool status:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
