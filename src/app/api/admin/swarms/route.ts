import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { redis } from "@/lib/redis";
import { listSuperadminInstances } from "@/services/ec2";
import { db } from "@/lib/db";

const CACHE_KEY = "admin:swarms:list";
const CACHE_TTL = 60; // seconds

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }

    const instances = await listSuperadminInstances();

    // Enrich with Hive workspace data
    const instanceIds = instances.map((i) => i.instanceId);
    const swarms = await db.swarm.findMany({
      where: { ec2Id: { in: instanceIds } },
      select: {
        ec2Id: true,
        workspace: { select: { name: true, slug: true } },
      },
    });

    const hiveMap = new Map(
      swarms
        .filter((s) => s.ec2Id)
        .map((s) => [s.ec2Id as string, { name: s.workspace.name, slug: s.workspace.slug }])
    );

    const enriched = instances.map((inst) => ({
      ...inst,
      hiveWorkspace: hiveMap.get(inst.instanceId) ?? null,
    }));

    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(enriched));
    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Error fetching EC2 instances:", error);
    return NextResponse.json(
      { error: "Failed to fetch instances" },
      { status: 500 }
    );
  }
}
