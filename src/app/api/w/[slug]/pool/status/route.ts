import { NextRequest, NextResponse } from "next/server";
import {
  resolveWorkspaceAccess,
  requireReadAccess,
} from "@/lib/auth/workspace-access";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { loadPoolRollout } from "@/lib/pods/rollout";
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

    // Token callers (org key / system API_TOKEN, e.g. a strut agent) get the
    // diagnostic extras. Everyone else keeps the original access path.
    const isTokenCaller = Boolean(request.headers.get("x-api-token"));
    let workspaceId: string;
    if (isTokenCaller) {
      const caller = await resolvePodCaller(request, { slug });
      if (caller instanceof NextResponse) {
        return caller.status === 403
          ? NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 })
          : caller;
      }
      workspaceId = caller.workspaceId;
    } else {
      // Public-viewable workspaces expose pool status (aggregate counters
      // only — no pod URLs, credentials, or IDs are returned). Anonymous
      // visitors are admitted by `resolveWorkspaceAccess` only when the
      // workspace is flagged `isPublicViewable`; everyone else gets 401/403.
      const access = await resolveWorkspaceAccess(request, { slug });
      const ok = requireReadAccess(access);
      if (ok instanceof NextResponse) return ok;
      workspaceId = ok.workspaceId;
    }

    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId,
      },
      select: {
        id: true,
        poolChangeId: true,
        poolChangeRequestedAt: true,
        poolPushedAt: true,
        poolPushError: true,
        minimumVms: true,
        minimumPods: true,
      },
    });

    if (!swarm?.id) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    try {
      const poolStatus = await getPoolStatusFromPods(swarm.id, workspaceId);

      if (!isTokenCaller) {
        return NextResponse.json({
          success: true,
          data: {
            status: poolStatus,
          },
        });
      }

      const [rollout, flaggedPods] = await Promise.all([
        loadPoolRollout(db, swarm),
        db.pod.count({
          where: {
            swarmId: swarm.id,
            deletedAt: null,
            flaggedForRecreation: true,
            podId: { not: { startsWith: "ws-pool-" } },
          },
        }),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          status: poolStatus,
          rollout,
          flaggedPods,
          minimumVms: swarm.minimumVms,
          minimumPods: swarm.minimumPods,
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
