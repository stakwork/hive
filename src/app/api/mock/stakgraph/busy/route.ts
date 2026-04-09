import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Busy Endpoint
 * Simulates: GET https://{swarm}:7799/busy
 */
export async function GET() {
  return NextResponse.json({ busy: false });
}
