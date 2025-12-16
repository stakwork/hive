import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";

const USE_MOCKS = config.USE_MOCKS;

/**
 * Mock LiveKit endpoint
 * Simulates LiveKit's URL structure without making external calls
 * 
 * In the real app, we don't actually call LiveKit APIs - we just construct URLs.
 * This mock endpoint exists to:
 * 1. Document the expected URL pattern
 * 2. Enable future webhook/callback mocking if needed
 * 3. Provide a consistent mock structure
 * 4. Allow testing without LiveKit credentials
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are disabled" },
      { status: 404 }
    );
  }

  const { path } = await params;
  const fullPath = path.join("/");
  
  console.log("[Mock LiveKit] Call link accessed:", fullPath);

  // Return success - in practice, LiveKit would serve the call UI here
  return NextResponse.json({
    success: true,
    message: "Mock LiveKit call endpoint",
    callPath: fullPath,
    note: "In production, this would serve the LiveKit call interface"
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are disabled" },
      { status: 404 }
    );
  }

  const { path } = await params;
  const fullPath = path.join("/");
  
  console.log("[Mock LiveKit] POST request to:", fullPath);

  // Support any POST operations if needed in the future
  return NextResponse.json({ 
    success: true,
    message: "Mock LiveKit POST endpoint",
    callPath: fullPath
  });
}
