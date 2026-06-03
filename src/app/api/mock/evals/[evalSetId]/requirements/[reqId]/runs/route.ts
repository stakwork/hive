import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { session_ids } = body ?? {};
  const count = Array.isArray(session_ids) ? session_ids.length : 0;

  return NextResponse.json({ success: true, linked: count });
}
