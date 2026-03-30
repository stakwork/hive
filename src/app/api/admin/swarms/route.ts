import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { redis } from "@/lib/redis";
import { listSuperadminInstances } from "@/services/ec2";

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
