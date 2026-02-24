import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifySphinxToken } from "@/lib/auth/sphinx-verify";

/**
 * POST /verify/[challenge]?token=...
 *
 * Verification endpoint called by the Sphinx app after user signs the challenge.
 * This endpoint must match the format expected by the Sphinx iOS/Android app:
 * - URL: https://{host}/verify/{challenge}?token={token}
 * - Body: JSON with pubkey, alias, photo_url, route_hint, price_to_meet (snake_case)
 *
 * @param request - NextRequest with token as query param and body containing user info
 * @param params - Route params containing the challenge k1 value
 * @returns JSON with success status
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ challenge: string }> }
) {
  try {
    const { challenge } = await params;

    // Validate challenge parameter
    if (!challenge || typeof challenge !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid challenge parameter" },
        { status: 400 }
      );
    }

    // Token comes from query parameter (as Sphinx app sends it)
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing token parameter" },
        { status: 400 }
      );
    }

    // Parse request body - Sphinx app sends snake_case field names
    let body: {
      pubkey?: string;
      alias?: string;
      photo_url?: string;
      route_hint?: string;
      price_to_meet?: number;
      verification_signature?: string;
    };
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error("Failed to parse request body", "SPHINX_AUTH", {
        error: parseError,
      });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { pubkey, alias, photo_url, route_hint } = body;

    // Validate required pubkey field
    if (!pubkey || typeof pubkey !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid pubkey" },
        { status: 400 }
      );
    }

    // Validate pubkey format (66 hex characters for compressed pubkey)
    if (!/^[0-9a-f]{66}$/i.test(pubkey)) {
      return NextResponse.json(
        { success: false, error: "Invalid pubkey format" },
        { status: 400 }
      );
    }

    // Fetch challenge from database
    let sphinxChallenge;
    try {
      sphinxChallenge = await db.sphinxChallenge.findUnique({
        where: { k1: challenge },
      });
    } catch (dbError) {
      logger.error("Database error fetching challenge", "SPHINX_AUTH", {
        error: dbError,
        challenge,
      });
      return NextResponse.json(
        { success: false, error: "Database error" },
        { status: 500 }
      );
    }

    // Validate challenge exists
    if (!sphinxChallenge) {
      return NextResponse.json(
        { success: false, error: "Challenge not found" },
        { status: 404 }
      );
    }

    // Check if challenge has already been used
    if (sphinxChallenge.used) {
      return NextResponse.json(
        { success: false, error: "Challenge already used" },
        { status: 400 }
      );
    }

    // Check if challenge has expired
    if (new Date() > sphinxChallenge.expiresAt) {
      return NextResponse.json(
        { success: false, error: "Challenge expired" },
        { status: 400 }
      );
    }

    // Verify the Lightning signature token
    const verifyResult = verifySphinxToken(token, pubkey);
    if (!verifyResult.valid) {
      logger.warn("Sphinx signature verification failed", "SPHINX_AUTH", {
        challenge,
        pubkey,
        reason: verifyResult.reason,
      });
      return NextResponse.json(
        { success: false, error: verifyResult.reason },
        { status: 401 }
      );
    }

    // Mark challenge as used and store pubkey
    try {
      await db.sphinxChallenge.update({
        where: { k1: challenge },
        data: {
          used: true,
          pubkey,
        },
      });
    } catch (dbError) {
      logger.error("Failed to update challenge", "SPHINX_AUTH", {
        error: dbError,
        challenge,
      });
      return NextResponse.json(
        { success: false, error: "Failed to mark challenge as used" },
        { status: 500 }
      );
    }

    logger.info("Sphinx challenge verified successfully", "SPHINX_AUTH", {
      challenge,
      pubkey,
      alias,
    });

    // Return success response matching the format Sphinx app expects
    return NextResponse.json({
      success: true,
      status: "ok",
      pubkey,
      alias: alias || "",
      photo_url: photo_url || "",
    });
  } catch (error) {
    logger.error("Error in Sphinx verify endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 }
    );
  }
}
