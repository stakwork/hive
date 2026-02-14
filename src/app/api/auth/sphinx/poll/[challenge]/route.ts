import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/auth/sphinx/poll/[challenge]
 * 
 * Polls the status of a Sphinx authentication challenge.
 * Used by frontend to check if challenge has been verified by Sphinx app.
 * 
 * @param request - NextRequest
 * @param params - Route params containing the challenge k1 value
 * @returns JSON with verification status and pubkey if verified
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ challenge: string }> }
) {
  try {
    const { challenge } = await params;

    // Validate challenge parameter
    if (!challenge || typeof challenge !== "string") {
      return NextResponse.json(
        { verified: false, error: "Invalid challenge parameter" },
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
        { verified: false, error: "Database error" },
        { status: 500 }
      );
    }

    // Challenge not found
    if (!sphinxChallenge) {
      return NextResponse.json(
        { verified: false, error: "Challenge not found" },
        { status: 404 }
      );
    }

    // Check if challenge has expired
    if (new Date() > sphinxChallenge.expiresAt) {
      return NextResponse.json(
        { verified: false, error: "Challenge expired" },
        { status: 200 }
      );
    }

    // Check if challenge has been verified (used and has pubkey)
    if (sphinxChallenge.used && sphinxChallenge.pubkey) {
      return NextResponse.json({
        verified: true,
        pubkey: sphinxChallenge.pubkey,
      });
    }

    // Challenge is still pending
    return NextResponse.json({
      verified: false,
    });
  } catch (error) {
    logger.error("Error in Sphinx poll endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { verified: false, error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
