import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const KEY_MAP: Record<string, string> = {
  hive: "hiveAmountUsd",
  graphmindset: "graphmindsetAmountUsd",
};

const TYPES = ["hive", "graphmindset"] as const;
type PriceType = (typeof TYPES)[number];

function toEntry(type: PriceType, value: string) {
  return { type, amountUsd: parseFloat(value) };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as PriceType | null;

  if (type) {
    const dbKey = KEY_MAP[type];
    if (!dbKey) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const config = await db.platformConfig.findUnique({ where: { key: dbKey } });
    if (!config) {
      return NextResponse.json(
        { error: "Price not configured" },
        { status: 503 }
      );
    }

    return NextResponse.json(toEntry(type, config.value));
  }

  // No type param — return all prices
  const configs = await db.platformConfig.findMany({
    where: { key: { in: Object.values(KEY_MAP) } },
  });

  const prices = TYPES.map((t) => {
    const record = configs.find((c) => c.key === KEY_MAP[t]);
    return record ? toEntry(t, record.value) : null;
  }).filter(Boolean);

  return NextResponse.json({ prices });
}
