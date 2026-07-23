import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import {
  RECURSION_MAX_CONCURRENT_KEY,
  RECURSION_MAX_ATTEMPTS_KEY,
  RECURSION_PLATEAU_LIMIT_KEY,
} from "@/services/legal-recursion-cron";
import { logger } from "@/lib/logger";

const RECURSION_MAX_CONCURRENT_DEFAULT = 3;
const RECURSION_MAX_ATTEMPTS_DEFAULT = 10;
const RECURSION_PLATEAU_LIMIT_DEFAULT = 3;

/**
 * Hardcoded allowlist of valid config keys for this route.
 * PlatformConfig.key has no schema-level enum constraint — without this,
 * the PATCH handler could write arbitrary keys into the platform config table.
 * Mirrors the pod-scaler admin-settings validKeys.includes(key) pattern.
 */
const VALID_KEYS = [
  RECURSION_MAX_CONCURRENT_KEY,
  RECURSION_MAX_ATTEMPTS_KEY,
  RECURSION_PLATEAU_LIMIT_KEY,
] as const;
type ValidKey = (typeof VALID_KEYS)[number];

function isValidKey(key: unknown): key is ValidKey {
  return typeof key === "string" && (VALID_KEYS as readonly string[]).includes(key);
}

function getDefaultForKey(key: ValidKey): number {
  switch (key) {
    case RECURSION_MAX_CONCURRENT_KEY:
      return RECURSION_MAX_CONCURRENT_DEFAULT;
    case RECURSION_MAX_ATTEMPTS_KEY:
      return RECURSION_MAX_ATTEMPTS_DEFAULT;
    case RECURSION_PLATEAU_LIMIT_KEY:
      return RECURSION_PLATEAU_LIMIT_DEFAULT;
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  // Return all three config keys so the UI can display them without separate requests
  const records = await db.platformConfig.findMany({
    where: { key: { in: [...VALID_KEYS] } },
    select: { key: true, value: true },
  });

  const configMap = new Map(records.map((r) => [r.key, r.value]));

  const settings = VALID_KEYS.map((key) => {
    const raw = configMap.get(key);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    const value = isNaN(parsed) || parsed < 1 ? getDefaultForKey(key) : parsed;
    return { key, value };
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

  // ── Allowlist validation (must happen before any upsert) ──────────────────
  if (!isValidKey(key)) {
    logger.warn(
      `[LegalRecursionSettings] PATCH rejected — key not in allowlist: ${String(key)}`,
      "legal",
      { key },
    );
    return NextResponse.json(
      { error: `Invalid key. Must be one of: ${VALID_KEYS.join(", ")}` },
      { status: 400 },
    );
  }

  // ── Value validation ──────────────────────────────────────────────────────
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return NextResponse.json({ error: "value must be an integer" }, { status: 400 });
  }

  if (value <= 0) {
    return NextResponse.json(
      { error: "value must be a positive integer (>= 1)" },
      { status: 400 },
    );
  }

  const config = await db.platformConfig.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });

  return NextResponse.json({ key, value: parseInt(config.value, 10) });
}
