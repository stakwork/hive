import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { userByLightningPubkey } from "@/lib/auth/lightning-pubkey";
import { createSphinxToken } from "@/lib/auth/sphinx-token";
import { acceptSphinxToken, sphinxTokenHost } from "@/lib/auth/sphinx-token-accept";

/**
 * POST /api/auth/sphinx/token
 * 
 * Exchanges a signed timestamp token for a JWT Bearer token.
 * This is a public endpoint used by the Sphinx mobile app to obtain authentication tokens.
 * No session is required - authentication is based on cryptographic signature verification.
 * 
 * Request body:
 * - token: string - Base64-encoded signed timestamp (69 bytes: 4 timestamp + 65 signature)
 * - pubkey: string - 66-character hex Lightning Network public key
 * - timestamp: number - Unix timestamp that was signed
 * - challenge?: string - A k1 from POST /api/auth/sphinx/challenge. A bound
 *   token (purpose `login`) names it; the exchange spends it, whichever form
 *   the token is. Without one only the bare token is possible, and only until
 *   `SPHINX_TOKEN_REQUIRE_BOUND` (docs/plans/sphinx-token-binding.md).
 * 
 * Response:
 * - token: string - JWT token for Bearer authentication (30-day expiry)
 * - tokenFormat: "bare" | "bound" - which form the Sphinx token was
 * 
 * Error responses:
 * - 400: Missing or invalid parameters; the challenge used or expired
 * - 401: Signature verification failed or user not found
 * - 404: The challenge not found
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body: { token?: string; pubkey?: string; timestamp?: number; challenge?: unknown };
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error("Failed to parse request body", "SPHINX_AUTH", { error: parseError });
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { token, pubkey, timestamp } = body;
    const challenge = typeof body.challenge === "string" && body.challenge ? body.challenge : null;

    // Validate required parameters
    if (!token || typeof token !== "string" || !pubkey || typeof pubkey !== "string" || !timestamp || typeof timestamp !== "number") {
      logger.warn("Missing or invalid parameters", "SPHINX_AUTH", { hasToken: !!token, hasPubkey: !!pubkey, hasTimestamp: !!timestamp });
      return NextResponse.json(
        { error: "Token, pubkey, and timestamp are required" },
        { status: 400 }
      );
    }

    if (body.challenge != null && challenge === null) {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 });
    }

    // A challenge Hive issued, still live: what a bound token here names.
    if (challenge !== null) {
      let issued;
      try {
        issued = await db.sphinxChallenge.findUnique({ where: { k1: challenge } });
      } catch (dbError) {
        logger.error("Database error fetching challenge", "SPHINX_AUTH", { error: dbError, challenge });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
      if (!issued) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
      if (issued.used) return NextResponse.json({ error: "Challenge already used" }, { status: 400 });
      if (new Date() > issued.expiresAt) return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }

    // Verify the signature (timestamp is extracted from token internally)
    const verifyResult = acceptSphinxToken(token, pubkey, {
      host: sphinxTokenHost(request),
      purpose: "login",
      challenge,
    });

    if (!verifyResult.valid) {
      logger.warn("Signature verification failed", "SPHINX_AUTH", { pubkey, reason: verifyResult.reason });
      return NextResponse.json(
        { error: verifyResult.reason },
        { status: 401 }
      );
    }

    // Spent once, by this request alone. It keeps no pubkey, so the QR sign-in
    // (which wants a used challenge with one) can never sign a browser in with it.
    if (challenge !== null) {
      const { count } = await db.sphinxChallenge.updateMany({
        where: { k1: challenge, used: false },
        data: { used: true },
      });
      if (count === 0) return NextResponse.json({ error: "Challenge already used" }, { status: 400 });
    }

    // By the pubkey's lookup hash, then the fields the JWT carries.
    let matchedUser: { id: string; email: string | null; name: string | null } | null = null;

    try {
      const found = await userByLightningPubkey(pubkey);
      if (found) {
        matchedUser = await db.user.findUnique({
          where: { id: found.id },
          select: { id: true, email: true, name: true },
        });
      }
    } catch (dbError) {
      logger.error("Database error while finding user", "SPHINX_AUTH", { error: dbError });
      return NextResponse.json(
        { error: "Failed to find user" },
        { status: 500 }
      );
    }

    if (!matchedUser) {
      logger.warn("No user found for pubkey", "SPHINX_AUTH", { pubkey });
      return NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      );
    }

    // Generate JWT token
    let jwtToken: string;
    try {
      jwtToken = await createSphinxToken(
        matchedUser.id,
        matchedUser.email,
        matchedUser.name
      );
    } catch (tokenError) {
      logger.error("Failed to generate JWT token", "SPHINX_AUTH", {
        error: tokenError,
        userId: matchedUser.id,
      });
      return NextResponse.json(
        { error: "Failed to generate authentication token" },
        { status: 500 }
      );
    }

    logger.info("Sphinx token exchanged successfully", "SPHINX_AUTH", {
      userId: matchedUser.id,
    });

    return NextResponse.json({ token: jwtToken, tokenFormat: verifyResult.format });
  } catch (error) {
    logger.error("Error in Sphinx token exchange endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
