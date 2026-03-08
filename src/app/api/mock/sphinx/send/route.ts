import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Mock Sphinx V2 Bot /send endpoint for direct DMs
// Only available when USE_MOCKS is enabled
export async function POST(req: NextRequest) {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = req.headers.get("x-admin-token");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (!body.dest) {
    return NextResponse.json({ error: "dest is required" }, { status: 400 });
  }

  return NextResponse.json({
    type: 0,
    message: "mock-sent",
    sender: "mock-sender",
    uuid: `mock-dm-${Date.now()}`,
  });
}
