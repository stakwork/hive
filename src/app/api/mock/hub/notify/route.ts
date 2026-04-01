import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Mock Sphinx HUB /notify endpoint for mobile push notifications
// Only available when USE_MOCKS is enabled
export async function POST(req: NextRequest) {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();

  if (!body.device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  return NextResponse.json({ success: true, mock: true });
}
