import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Swarm check-domain API
 * GET /api/super/check-domain?domain=... - Validate domain/URI
 * Note: No authentication required for mock endpoints
 */
export async function GET(request: NextRequest) {
  try {

    const { searchParams } = request.nextUrl;
    const domain = searchParams.get("domain");

    if (!domain) {
      return NextResponse.json({ error: "Domain parameter is required" }, { status: 400 });
    }

    console.log("[Mock Swarm] Validating domain:", domain);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 100));

    // Simulate domain validation logic
    const isValidDomain = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$/.test(domain) && !domain.includes("..");
    const isAvailable = Math.random() > 0.3; // 70% chance it's available

    const mockResponse = {
      domain: domain,
      valid: isValidDomain,
      available: isValidDomain && isAvailable,
      message: isValidDomain
        ? (isAvailable ? "Domain is available" : "Domain is already taken")
        : "Invalid domain format",
      suggestions: !isAvailable ? [
        `${domain}-alt`,
        `${domain}-2024`,
        `${domain}-new`
      ] : undefined,
      checked_at: new Date().toISOString(),
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Swarm check-domain:", error);
    return NextResponse.json({ error: "Failed to validate domain" }, { status: 500 });
  }
}