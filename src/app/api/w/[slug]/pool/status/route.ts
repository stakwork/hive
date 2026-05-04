import { NextRequest, NextResponse } from "next/server";
import {
  resolveWorkspaceAccess,
  requireReadAccess,
} from "@/lib/auth/workspace-access";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    // Public-viewable workspaces expose pool status (aggregate counters
    // only — no pod URLs, credentials, or IDs are returned). Anonymous
    // visitors are admitted by `resolveWorkspaceAccess` only when the
    // workspace is flagged `isPublicViewable`; everyone else gets 401/403.
    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: ok.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!swarm?.id) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    try {
      const poolStatus = await getPoolStatusFromPods(swarm.id, ok.workspaceId);

      return NextResponse.json({
        success: true,
        data: {
          status: poolStatus,
        },
      });
    } catch (error) {
      console.error("Database query failed:", error);
      const message = error instanceof Error ? error.message : "Unable to fetch pool data right now";
      return NextResponse.json(
        {
          success: false,
          message,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in pool status endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
