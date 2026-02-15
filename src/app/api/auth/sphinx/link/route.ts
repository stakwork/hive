import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/sphinx/link
 *
 * Links a verified Sphinx Lightning pubkey to the current session user.
 * Requires an authenticated session (GitHub login).
 *
 * Body: { challenge: string } — the k1 of a verified SphinxChallenge
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { challenge } = body;

    if (!challenge || typeof challenge !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid challenge" },
        { status: 400 },
      );
    }

    // Look up the verified challenge
    const sphinxChallenge = await db.sphinxChallenge.findUnique({
      where: { k1: challenge },
    });

    if (!sphinxChallenge) {
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 },
      );
    }

    if (!sphinxChallenge.used || !sphinxChallenge.pubkey) {
      return NextResponse.json(
        { error: "Challenge not verified" },
        { status: 400 },
      );
    }

    if (new Date() > sphinxChallenge.expiresAt) {
      return NextResponse.json(
        { error: "Challenge expired" },
        { status: 400 },
      );
    }

    const pubkey = sphinxChallenge.pubkey;
    const encryptionService = EncryptionService.getInstance();

    // Encrypt the pubkey for storage
    const encryptedPubkey = encryptionService.encryptField(
      "lightningPubkey",
      pubkey,
    );

    // Update user with encrypted Lightning pubkey
    await db.user.update({
      where: { id: userId },
      data: {
        lightningPubkey: JSON.stringify(encryptedPubkey),
      },
    });

    // Upsert Account record for sphinx provider
    await db.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "sphinx",
          providerAccountId: pubkey,
        },
      },
      update: {
        userId,
      },
      create: {
        userId,
        type: "credentials",
        provider: "sphinx",
        providerAccountId: pubkey,
      },
    });

    logger.info("Sphinx pubkey linked to user", "SPHINX_LINK", {
      userId,
    });

    return NextResponse.json({ success: true, pubkey });
  } catch (error) {
    logger.error("Error in Sphinx link endpoint", "SPHINX_LINK", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth/sphinx/link
 *
 * Unlinks the Sphinx wallet from the current session user.
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Remove Lightning pubkey from user
    await db.user.update({
      where: { id: userId },
      data: { lightningPubkey: null },
    });

    // Delete sphinx Account records for this user
    await db.account.deleteMany({
      where: {
        userId,
        provider: "sphinx",
      },
    });

    logger.info("Sphinx pubkey unlinked from user", "SPHINX_UNLINK", {
      userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error in Sphinx unlink endpoint", "SPHINX_UNLINK", {
      error,
    });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
