/**
 * POST /api/system-map/finding-fix/webhook — callback from the fix agent
 * workflow: `{ fixId, status, prUrl?, error? }`, authenticated by `x-api-token`.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { applyFindingFixCallback } from "@/services/system-map/finding-fix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    fixId: z.string().min(1),
    status: z.string().max(50).optional(),
    prUrl: z.string().max(500).nullish(),
    error: z.string().max(2000).nullish(),
  })
  .strip();

function isAuthorized(request: NextRequest): boolean {
  const token = Buffer.from(request.headers.get("x-api-token") ?? "");
  const expected = Buffer.from(process.env.API_TOKEN ?? "");
  return token.length > 0 && token.length === expected.length && timingSafeEqual(token, expected);
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });

    const fix = await applyFindingFixCallback(parsed.data);
    if (!fix) return NextResponse.json({ error: "Fix not found" }, { status: 404 });
    return NextResponse.json({ success: true, fixId: fix.id, status: fix.status, prUrl: fix.prUrl });
  } catch (error) {
    console.error("[SystemMap] finding fix webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
