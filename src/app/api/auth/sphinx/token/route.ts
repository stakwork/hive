import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { createSphinxToken } from "@/lib/auth/sphinx-token";
import { verifySphinxToken } from "@/lib/auth/sphinx-verify";

const encryptionService = EncryptionService.getInstance();

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
 * 
 * Response:
 * - token: string - JWT token for Bearer authentication (30-day expiry)
 * 
 * Error responses:
 * - 400: Missing or invalid parameters
 * - 401: Signature verification failed or user not found
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body: { token?: string; pubkey?: string; timestamp?: number };
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

    // Validate required parameters
    if (!token || typeof token !== "string" || !pubkey || typeof pubkey !== "string" || !timestamp || typeof timestamp !== "number") {
      logger.warn("Missing or invalid parameters", "SPHINX_AUTH", { hasToken: !!token, hasPubkey: !!pubkey, hasTimestamp: !!timestamp });
      return NextResponse.json(
        { error: "Token, pubkey, and timestamp are required" },
        { status: 400 }
      );
    }

    // Verify the signature (timestamp is extracted from token internally)
    const verifyResult = verifySphinxToken(token, pubkey);

    if (!verifyResult.valid) {
      logger.warn("Signature verification failed", "SPHINX_AUTH", { pubkey, reason: verifyResult.reason });
      return NextResponse.json(
        { error: verifyResult.reason },
        { status: 401 }
      );
    }

    // Find user by decrypting and comparing lightningPubkey fields
    let matchedUser: { id: string; email: string | null; name: string | null } | null = null;
    
    try {
      // Get all users with a lightningPubkey set
      const usersWithPubkey = await db.user.findMany({
        where: {
          lightningPubkey: { not: null },
        },
        select: {
          id: true,
          email: true,
          name: true,
          lightningPubkey: true,
        },
      });

      // Decrypt and compare each pubkey to find a match
      for (const user of usersWithPubkey) {
        if (!user.lightningPubkey) continue;

        try {
          // Parse the JSON string first
          const encryptedData = JSON.parse(user.lightningPubkey);
          const decryptedPubkey = encryptionService.decryptField(
            "lightningPubkey",
            encryptedData
          );

          if (decryptedPubkey === pubkey) {
            matchedUser = {
              id: user.id,
              email: user.email,
              name: user.name,
            };
            break;
          }
        } catch (decryptError) {
          // Log decryption error but continue checking other users
          logger.error("Failed to decrypt user pubkey", "SPHINX_AUTH", {
            error: decryptError,
            userId: user.id,
          });
          continue;
        }
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

    return NextResponse.json({ token: jwtToken });
  } catch (error) {
    logger.error("Error in Sphinx token exchange endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
