import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { target_type, task_id, feature_id, agent_log_id } = body ?? {};
  return NextResponse.json({ success: true, ref_id: crypto.randomUUID(), linked: 1 });
}
