import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { createSphinxToken } from "@/lib/auth/sphinx-token";

const encryptionService = EncryptionService.getInstance();

/**
 * POST /api/auth/sphinx/link
 * 
 * Links a verified Sphinx challenge pubkey to the currently authenticated user.
 * This endpoint requires an active user session and a verified challenge that has been
 * successfully signed by the Sphinx app.
 * 
 * Request body:
 * - challenge: string - The k1 challenge string that has been verified
 * 
 * Response:
 * - token: string - JWT token for Bearer authentication (30-day expiry)
 * 
 * Error responses:
 * - 401: No active session
 * - 404: Challenge not found
 * - 400: Challenge invalid, expired, or not verified
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Require authenticated session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      logger.warn("Sphinx link attempt without session", "SPHINX_AUTH");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Parse request body
    let body: { challenge?: string };
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error("Failed to parse request body", "SPHINX_AUTH", { error: parseError });
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { challenge } = body;

    if (!challenge || typeof challenge !== "string") {
      logger.warn("Missing or invalid challenge parameter", "SPHINX_AUTH", { userId });
      return NextResponse.json(
        { error: "Challenge is required" },
        { status: 400 }
      );
    }

    // Lookup challenge in database
    const sphinxChallenge = await db.sphinxChallenge.findUnique({
      where: { k1: challenge },
    });

    if (!sphinxChallenge) {
      logger.warn("Challenge not found", "SPHINX_AUTH", { challenge, userId });
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    // Validate challenge state
    if (!sphinxChallenge.used) {
      logger.warn("Challenge not verified", "SPHINX_AUTH", { challenge, userId });
      return NextResponse.json(
        { error: "Challenge not verified" },
        { status: 400 }
      );
    }

    if (!sphinxChallenge.pubkey) {
      logger.warn("Challenge missing pubkey", "SPHINX_AUTH", { challenge, userId });
      return NextResponse.json(
        { error: "Challenge not verified" },
        { status: 400 }
      );
    }

    // Check if challenge has expired
    if (sphinxChallenge.expiresAt < new Date()) {
      logger.warn("Challenge expired", "SPHINX_AUTH", { 
        challenge, 
        userId, 
        expiresAt: sphinxChallenge.expiresAt 
      });
      
      // Clean up expired challenge
      await db.sphinxChallenge.delete({
        where: { k1: challenge },
      }).catch((err) => {
        logger.error("Failed to delete expired challenge", "SPHINX_AUTH", { error: err });
      });
      
      return NextResponse.json(
        { error: "Challenge expired" },
        { status: 400 }
      );
    }

    const pubkey = sphinxChallenge.pubkey;

    // Encrypt pubkey before storing
    let encryptedPubkey: string;
    try {
      const encrypted = encryptionService.encryptField("lightningPubkey", pubkey);
      encryptedPubkey = JSON.stringify(encrypted);
    } catch (encryptError) {
      logger.error("Failed to encrypt pubkey", "SPHINX_AUTH", { 
        error: encryptError, 
        userId 
      });
      return NextResponse.json(
        { error: "Failed to encrypt pubkey" },
        { status: 500 }
      );
    }

    // Update user with encrypted pubkey and upsert Account record
    try {
      await db.$transaction(async (tx) => {
        // Update user with encrypted Lightning pubkey
        await tx.user.update({
          where: { id: userId },
          data: { lightningPubkey: encryptedPubkey },
        });

        // Check if user already has a Sphinx account
        const existingAccount = await tx.account.findFirst({
          where: {
            userId,
            provider: "sphinx",
          },
        });

        if (existingAccount) {
          // Update existing account with new pubkey
          await tx.account.update({
            where: { id: existingAccount.id },
            data: { providerAccountId: pubkey },
          });
        } else {
          // Create new account
          await tx.account.create({
            data: {
              userId,
              type: "oauth",
              provider: "sphinx",
              providerAccountId: pubkey,
            },
          });
        }
      });

      logger.info("Sphinx pubkey linked to user", "SPHINX_AUTH", { 
        userId,
        challenge 
      });
    } catch (dbError) {
      logger.error("Failed to link pubkey to user", "SPHINX_AUTH", { 
        error: dbError, 
        userId 
      });
      return NextResponse.json(
        { error: "Failed to link Sphinx account" },
        { status: 500 }
      );
    }

    // Generate JWT token
    let token: string;
    try {
      token = await createSphinxToken(
        session.user.id,
        session.user.email,
        session.user.name
      );
    } catch (tokenError) {
      logger.error("Failed to generate JWT token", "SPHINX_AUTH", { 
        error: tokenError, 
        userId 
      });
      return NextResponse.json(
        { error: "Failed to generate authentication token" },
        { status: 500 }
      );
    }

    // Delete used challenge
    try {
      await db.sphinxChallenge.delete({
        where: { k1: challenge },
      });
      logger.info("Used challenge deleted", "SPHINX_AUTH", { challenge });
    } catch (deleteError) {
      // Log error but don't fail the request since linking succeeded
      logger.error("Failed to delete used challenge", "SPHINX_AUTH", { 
        error: deleteError, 
        challenge 
      });
    }

    return NextResponse.json({ token });
  } catch (error) {
    logger.error("Error in Sphinx link endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
