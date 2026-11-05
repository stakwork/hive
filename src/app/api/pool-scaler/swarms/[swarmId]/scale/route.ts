import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classifyCallerToken } from "@/lib/auth/caller-token";
import { applyPoolScale, getPodScalerCeiling, getPodUsage, getSwarmFloor } from "@/lib/pods/scaler";

export const dynamic = "force-dynamic";

const LOG_PREFIX = "[PoolScalerApi]";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ swarmId: string }> },
) {
  const caller = await classifyCallerToken(request);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.kind !== "system") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { swarmId } = await params;

  let body: { minimumVms?: unknown; maxVms?: unknown; dryRun?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = body?.minimumVms;
  if (typeof target !== "number" || !Number.isInteger(target)) {
    return NextResponse.json({ error: "minimumVms must be an integer" }, { status: 400 });
  }
  const requestedMax = body.maxVms;
  if (
    requestedMax !== undefined &&
    (typeof requestedMax !== "number" || !Number.isInteger(requestedMax) || requestedMax <= 0)
  ) {
    return NextResponse.json({ error: "maxVms must be a positive integer" }, { status: 400 });
  }
  const dryRun = body.dryRun === true;

  try {
    const swarm = await db.swarm.findFirst({
      where: { id: swarmId, poolApiKey: { not: null }, workspace: { deleted: false } },
      select: { id: true, minimumVms: true, minimumPods: true, poolApiKey: true },
    });
    if (!swarm) return NextResponse.json({ error: "Swarm not found" }, { status: 404 });

    const ceiling = await getPodScalerCeiling();
    const maxVms = requestedMax === undefined ? ceiling : Math.min(ceiling, requestedMax);
    const capSource =
      requestedMax !== undefined && requestedMax < ceiling ? "maxVms" : "Hive ceiling";

    const floor = getSwarmFloor(swarm);
    if (floor > maxVms) {
      return NextResponse.json(
        { error: `swarm floor of ${floor} exceeds the cap of ${maxVms} (${capSource})` },
        { status: 400 },
      );
    }
    if (target > maxVms) {
      return NextResponse.json(
        { error: `minimumVms ${target} exceeds the cap of ${maxVms} (${capSource})` },
        { status: 400 },
      );
    }
    if (target < floor) {
      return NextResponse.json(
        { error: `minimumVms ${target} is below the swarm floor of ${floor}` },
        { status: 400 },
      );
    }

    const { usedVms } = await getPodUsage(swarm.id);
    if (target < usedVms) {
      return NextResponse.json(
        { error: `minimumVms ${target} is below pods currently in use (${usedVms})` },
        { status: 400 },
      );
    }

    const previous = swarm.minimumVms;
    if (dryRun) {
      return NextResponse.json({ swarmId, previous, applied: target, maxVms, changed: false, dryRun: true });
    }
    if (target === previous) {
      return NextResponse.json({ swarmId, previous, applied: previous, maxVms, changed: false });
    }

    try {
      await applyPoolScale(swarm, target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Scale failed for swarm ${swarmId}:`, message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    console.log(`${LOG_PREFIX} Scaled swarm ${swarmId}: ${previous} -> ${target}`);
    return NextResponse.json({ swarmId, previous, applied: target, maxVms, changed: true });
  } catch (error) {
    console.error(`${LOG_PREFIX} Unexpected error scaling swarm ${swarmId}:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
