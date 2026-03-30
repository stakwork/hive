import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { SWARM_DEFAULT_INSTANCE_TYPE } from "@/lib/constants";
import { generateSecurePassword } from "@/lib/utils/password";
import { redis } from "@/lib/redis";
import { listSuperadminInstances } from "@/services/ec2";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";

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
    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(instances));
    return NextResponse.json(instances);
  } catch (error) {
    console.error("Error fetching EC2 instances:", error);
    return NextResponse.json(
      { error: "Failed to fetch instances" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { password: bodyPassword, workspace_type } = body as {
      password?: string;
      workspace_type?: string;
    };

    const password = bodyPassword ?? generateSecurePassword();
    const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;

    const swarmService = new SwarmService(getServiceConfig("swarm"));
    const result = await swarmService.createSwarm({
      instance_type,
      password,
      ...(workspace_type ? { workspace_type } : {}),
    });

    return NextResponse.json({ ...result, password });
  } catch (error) {
    console.error("Error creating swarm:", error);
    return NextResponse.json(
      { error: "Failed to create swarm" },
      { status: 500 }
    );
  }
}
