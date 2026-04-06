import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

const KEY_MAP: Record<string, string> = {
  hive: "hiveAmountUsd",
  graphmindset: "graphmindsetAmountUsd",
};

const TYPES = ["hive", "graphmindset"] as const;
type PriceType = (typeof TYPES)[number];

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const configs = await db.platformConfig.findMany({
    where: { key: { in: Object.values(KEY_MAP) } },
  });

  const prices = TYPES.map((type) => {
    const record = configs.find((c) => c.key === KEY_MAP[type]);
    return { type, amountUsd: record ? parseFloat(record.value) : 50 };
  });

  return NextResponse.json({ prices });
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = await request.json();
  const { type, amountUsd } = body as { type: PriceType; amountUsd: unknown };

  if (!type || !KEY_MAP[type]) {
    return NextResponse.json(
      { error: "type must be 'hive' or 'graphmindset'" },
      { status: 400 }
    );
  }

  if (typeof amountUsd !== "number" || amountUsd <= 0) {
    return NextResponse.json(
      { error: "amountUsd must be a positive number" },
      { status: 400 }
    );
  }

  const dbKey = KEY_MAP[type];
  const config = await db.platformConfig.upsert({
    where: { key: dbKey },
    update: { value: String(amountUsd) },
    create: { key: dbKey, value: String(amountUsd) },
  });

  return NextResponse.json({ type, amountUsd: parseFloat(config.value) });
}
