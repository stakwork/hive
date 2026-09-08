import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { describeInstance } from "@/services/ec2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[AdminSwarmGet]";

/**
 * GET /api/admin/swarms/[instanceId] — live, cache-free single-instance EC2 read.
 *
 * Super-admin gated BEFORE any AWS call. Does not read or write the
 * `admin:swarms:list` Redis cache — the point of this route is to resolve
 * tags (notably UserAssignedName) even when that cache is cold.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  try {
    const instance = await describeInstance(instanceId);
    if (!instance) {
      console.error(`${LOG_PREFIX} instance=${instanceId} outcome=not-found`);
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }
    return NextResponse.json(instance);
  } catch {
    console.error(`${LOG_PREFIX} instance=${instanceId} outcome=aws-error`);
    return NextResponse.json({ error: "Failed to fetch instance" }, { status: 500 });
  }
}
