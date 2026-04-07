import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { redis } from "@/lib/redis";
import { startInstance, stopInstance } from "@/services/ec2";

const CACHE_KEY = "admin:swarms:list";

const actionSchema = z.object({
  action: z.enum(["start", "stop"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid action. Must be 'start' or 'stop'" },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.action === "start") {
      await startInstance(instanceId);
    } else {
      await stopInstance(instanceId);
    }

    await redis.del(CACHE_KEY);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Error performing ${parsed.data.action} on ${instanceId}:`, error);
    return NextResponse.json(
      { error: `Failed to ${parsed.data.action} instance` },
      { status: 500 }
    );
  }
}
