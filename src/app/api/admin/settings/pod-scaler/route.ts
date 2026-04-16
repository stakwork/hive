import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import {
  POD_SCALER_CONFIG_KEYS,
  POD_SCALER_QUEUE_WAIT_MINUTES,
  POD_SCALER_STALENESS_WINDOW_DAYS,
  POD_SCALER_SCALE_UP_BUFFER,
  POD_SCALER_MAX_VM_CEILING,
  POD_SCALER_SCALE_DOWN_COOLDOWN_MINUTES,
  POD_SCALER_CRON_ENABLED_DEFAULT,
  POD_SCALER_UTILISATION_THRESHOLD,
} from "@/lib/constants/pod-scaler";

type PodScalerKey = keyof typeof POD_SCALER_CONFIG_KEYS;

const DEFAULTS: Record<PodScalerKey, number> = {
  queueWaitMinutes: POD_SCALER_QUEUE_WAIT_MINUTES,
  stalenessWindowDays: POD_SCALER_STALENESS_WINDOW_DAYS,
  scaleUpBuffer: POD_SCALER_SCALE_UP_BUFFER,
  maxVmCeiling: POD_SCALER_MAX_VM_CEILING,
  scaleDownCooldownMinutes: POD_SCALER_SCALE_DOWN_COOLDOWN_MINUTES,
  cronEnabled: POD_SCALER_CRON_ENABLED_DEFAULT ? 1 : 0,
  podUtilisationThreshold: POD_SCALER_UTILISATION_THRESHOLD,
};

const DB_KEYS = Object.values(POD_SCALER_CONFIG_KEYS);

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const configs = await db.platformConfig.findMany({
    where: { key: { in: DB_KEYS } },
  });

  const settings = (Object.keys(POD_SCALER_CONFIG_KEYS) as PodScalerKey[]).map((key) => {
    const dbKey = POD_SCALER_CONFIG_KEYS[key];
    const record = configs.find((c) => c.key === dbKey);
    return { key, value: record ? parseInt(record.value, 10) : DEFAULTS[key] };
  });

  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = await request.json();
  const { key, value } = body as { key: unknown; value: unknown };

  const validKeys = Object.keys(POD_SCALER_CONFIG_KEYS) as PodScalerKey[];
  if (!key || !validKeys.includes(key as PodScalerKey)) {
    return NextResponse.json(
      { error: `key must be one of: ${validKeys.join(", ")}` },
      { status: 400 }
    );
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return NextResponse.json(
      { error: "value must be an integer" },
      { status: 400 }
    );
  }

  // cronEnabled only accepts 0 or 1; podUtilisationThreshold must be 1–100; all other keys must be positive integers
  if (key === "cronEnabled") {
    if (value !== 0 && value !== 1) {
      return NextResponse.json(
        { error: "cronEnabled value must be 0 or 1" },
        { status: 400 }
      );
    }
  } else if (key === "podUtilisationThreshold") {
    if (value < 1 || value > 100) {
      return NextResponse.json(
        { error: "podUtilisationThreshold value must be an integer between 1 and 100" },
        { status: 400 }
      );
    }
  } else {
    if (value <= 0) {
      return NextResponse.json(
        { error: "value must be a positive integer" },
        { status: 400 }
      );
    }
  }

  const dbKey = POD_SCALER_CONFIG_KEYS[key as PodScalerKey];
  const config = await db.platformConfig.upsert({
    where: { key: dbKey },
    update: { value: String(value) },
    create: { key: dbKey, value: String(value) },
  });

  return NextResponse.json({ key, value: parseInt(config.value, 10) });
}
