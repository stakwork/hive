import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { RECURSION_MAX_CONCURRENT_KEY } from "@/services/legal-recursion-cron";

const RECURSION_MAX_CONCURRENT_DEFAULT = 3;

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const record = await db.platformConfig.findUnique({
    where: { key: RECURSION_MAX_CONCURRENT_KEY },
  });

  const value = record ? parseInt(record.value, 10) : RECURSION_MAX_CONCURRENT_DEFAULT;

  return NextResponse.json({ key: RECURSION_MAX_CONCURRENT_KEY, value });
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = await request.json();
  const { value } = body as { value: unknown };

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return NextResponse.json({ error: "value must be an integer" }, { status: 400 });
  }

  if (value <= 0) {
    return NextResponse.json(
      { error: "value must be a positive integer (>= 1)" },
      { status: 400 }
    );
  }

  const config = await db.platformConfig.upsert({
    where: { key: RECURSION_MAX_CONCURRENT_KEY },
    update: { value: String(value) },
    create: { key: RECURSION_MAX_CONCURRENT_KEY, value: String(value) },
  });

  return NextResponse.json({ key: RECURSION_MAX_CONCURRENT_KEY, value: parseInt(config.value, 10) });
}
