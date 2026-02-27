import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Mock Sphinx action endpoint
// Only available when USE_MOCKS is enabled
export async function POST() {
  // Gate with USE_MOCKS check
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mock successful Sphinx message send
  return NextResponse.json({
    success: true,
    messageId: "mock-message-id",
  });
}
