import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classifyCallerToken } from "@/lib/auth/caller-token";
import { getPodScalerCeiling, getPodUsage, getSwarmFloor } from "@/lib/pods/scaler";

export const dynamic = "force-dynamic";

const LOG_PREFIX = "[PoolScalerApi]";

export async function GET(request: NextRequest) {
  const caller = await classifyCallerToken(request);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.kind !== "system") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const swarms = await db.swarm.findMany({
      where: { poolApiKey: { not: null }, workspace: { deleted: false } },
      select: {
        id: true,
        workspaceId: true,
        minimumVms: true,
        minimumPods: true,
        workspace: { select: { slug: true } },
      },
    });

    const maxVmsCeiling = await getPodScalerCeiling();
    const result = await Promise.all(
      swarms.map(async (s) => ({
        swarmId: s.id,
        workspaceId: s.workspaceId,
        workspaceSlug: s.workspace.slug,
        floor: getSwarmFloor(s),
        current: s.minimumVms,
        ...(await getPodUsage(s.id)),
      })),
    );

    return NextResponse.json({ limits: { maxVmsCeiling }, swarms: result });
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to list swarms:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
