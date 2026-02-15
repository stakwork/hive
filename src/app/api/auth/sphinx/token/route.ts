import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createSphinxJWT } from "@/lib/auth/sphinx-token";

/**
 * POST /api/auth/sphinx/token
 *
 * Issues a JWT for a verified Sphinx pubkey. No session required.
 * The pubkey must already be linked to a user via /api/auth/sphinx/link.
 *
 * Body: { challenge: string } — the k1 of a verified SphinxChallenge
 */
export async function POST(request: Request) {
  try {
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

    const pubkey = sphinxChallenge.pubkey;

    // Find user via Account with provider "sphinx" and matching pubkey
    const account = await db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "sphinx",
          providerAccountId: pubkey,
        },
      },
      select: { userId: true },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Pubkey not linked to any account" },
        { status: 404 },
      );
    }

    const token = await createSphinxJWT(account.userId);

    logger.info("Sphinx JWT issued", "SPHINX_TOKEN", {
      userId: account.userId,
    });

    return NextResponse.json({ token });
  } catch (error) {
    logger.error("Error in Sphinx token endpoint", "SPHINX_TOKEN", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
