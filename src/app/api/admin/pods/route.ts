import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { PodUsageStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const workspaces = await db.workspace.findMany({
      where: { deleted: false },
      select: {
        id: true,
        swarm: {
          select: {
            pods: {
              where: { deletedAt: null },
              select: {
                usageStatus: true,
              },
            },
          },
        },
      },
    });

    const result = workspaces.map((workspace) => {
      const pods = workspace.swarm?.pods || [];
      const usedVms = pods.filter(
        (pod) => pod.usageStatus === PodUsageStatus.USED
      ).length;
      const totalPods = pods.length;

      return {
        workspaceId: workspace.id,
        usedVms,
        totalPods,
      };
    });

    return NextResponse.json({ workspaces: result });
  } catch (error) {
    console.error("Error fetching pod counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch pod counts" },
      { status: 500 }
    );
  }
}
