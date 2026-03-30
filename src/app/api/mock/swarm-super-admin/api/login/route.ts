import { NextRequest, NextResponse } from "next/server";

/**
 * Mock endpoint for swarm JWT login
 * POST /api/mock/swarm-super-admin/api/login
 *
 * This mirrors the login endpoint that getSwarmCmdJwt calls on port 8800.
 * In mock mode the cmd route handles JWT acquisition server-side using this endpoint.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json({ token: "mock-jwt-token" });
}
