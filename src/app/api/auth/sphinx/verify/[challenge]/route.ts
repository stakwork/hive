import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifySphinxToken } from "@/lib/auth/sphinx-verify";

interface VerifyRequestBody {
  token: string;
  pubkey: string;
  alias?: string;
  photoUrl?: string;
  routeHint?: string;
}

/**
 * POST /api/auth/sphinx/verify/[challenge]
 * 
 * Verifies a Lightning signature against a challenge and marks it as used.
 * Called by the Sphinx app after user signs the challenge.
 * 
 * @param request - NextRequest with body containing token, pubkey, and optional profile data
 * @param params - Route params containing the challenge k1 value
 * @returns JSON with success status and error message if applicable
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

    // Parse request body
    let body: VerifyRequestBody;
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error("Failed to parse request body", "SPHINX_AUTH", { error: parseError });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { token, pubkey, alias, photoUrl, routeHint } = body;

    // Validate required fields
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid token" },
        { status: 400 }
      );
    }

    if (!pubkey || typeof pubkey !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid pubkey" },
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
      logger.error("Database error fetching challenge", "SPHINX_AUTH", { error: dbError, challenge });
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

    // Verify the Lightning signature (timestamp is extracted from token internally)
    const verifyResult = verifySphinxToken(token, pubkey);

    if (!verifyResult.valid) {
      logger.warn("Sphinx signature verification failed", "SPHINX_AUTH", { challenge, pubkey, reason: verifyResult.reason });
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
      logger.error("Failed to update challenge", "SPHINX_AUTH", { error: dbError, challenge });
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

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    logger.error("Error in Sphinx verify endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
