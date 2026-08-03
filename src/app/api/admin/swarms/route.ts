import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { SWARM_DEFAULT_INSTANCE_TYPE } from "@/lib/constants";
import { generateSecurePassword } from "@/lib/utils/password";
import { redis } from "@/lib/redis";
import { listSuperadminInstances } from "@/services/ec2";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";
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
      swarms.filter((s) => s.ec2Id).map((s) => [s.ec2Id as string, { name: s.workspace.name, slug: s.workspace.slug }]),
    );

    let enriched = instances.map((inst) => ({
      ...inst,
      hiveWorkspace: hiveMap.get(inst.instanceId) ?? null,
    }));

    // Step 2 (fallback): for instances not matched by ec2Id, try matching via
    // UserAssignedName tag anchored to the .sphinx.chat domain boundary.
    // Guard against empty-string tag values — `contains: ""` would match every row.
    const unmatchedNames = enriched
      .filter((inst) => inst.hiveWorkspace === null)
      .flatMap((inst) => {
        const tagValue = inst.tags.find((t) => t.key === "UserAssignedName")?.value;
        return tagValue && tagValue.trim() !== "" ? [tagValue] : [];
      });

    if (unmatchedNames.length > 0) {
      // NOTE: swarm_url has no B-tree index in the schema (only @@index([swarmId]) exists).
      // Prisma `contains` emits a leading-wildcard LIKE which cannot use a B-tree index and
      // forces a full table scan on Swarm. Acceptable for this admin-only endpoint on a small
      // table today. A future index on swarm_url would eliminate the scan.
      const fallbackSwarms = await db.swarm.findMany({
        where: {
          OR: unmatchedNames.map((n) => ({ swarmUrl: { contains: `${n}.sphinx.chat` } })),
        },
        select: { swarmUrl: true, workspace: { select: { name: true, slug: true } } },
      });

      // Key fallbackMap by UserAssignedName (not ec2Id) to avoid key-space collisions.
      const fallbackMap = new Map<string, { name: string; slug: string }>();
      for (const swarm of fallbackSwarms) {
        if (!swarm.swarmUrl) continue;
        const matchedName = unmatchedNames.find((n) => swarm.swarmUrl!.includes(`${n}.sphinx.chat`));
        if (matchedName) {
          fallbackMap.set(matchedName, {
            name: swarm.workspace.name,
            slug: swarm.workspace.slug,
          });
        }
      }

      enriched = enriched.map((inst) => {
        if (inst.hiveWorkspace !== null) return inst;
        const tagValue = inst.tags.find((t) => t.key === "UserAssignedName")?.value;
        if (!tagValue) return inst;
        const fallback = fallbackMap.get(tagValue);
        return fallback ? { ...inst, hiveWorkspace: fallback } : inst;
      });
    }

    // Cache is written after both enrichment passes so it contains fully-resolved workspace values.
    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(enriched));
    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Error fetching EC2 instances:", error);
    return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { password: bodyPassword } = body as {
      password?: string;
    };

    const password = bodyPassword ?? generateSecurePassword();
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;

    const swarmService = new SwarmService(getServiceConfig("swarm"));
    const result = await swarmService.createSwarm({
      instance_type,
      password,
    });

    return NextResponse.json({ ...result, password });
  } catch (error) {
    console.error("Error creating swarm:", error);
    return NextResponse.json({ error: "Failed to create swarm" }, { status: 500 });
  }
}
