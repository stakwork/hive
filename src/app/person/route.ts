import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { userByLightningPubkey } from "@/lib/auth/lightning-pubkey";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner_pubkey, owner_alias, owner_route_hint } = body;

    if (!owner_pubkey || typeof owner_pubkey !== "string") {
      logger.warn("Missing or invalid owner_pubkey in /person request", "SPHINX_PERSON");
      return NextResponse.json({ error: "owner_pubkey is required" }, { status: 400 });
    }

    // By the pubkey's lookup hash. A string that is not a Sphinx pubkey finds no one: 404, as before.
    const matchedUserId = (await userByLightningPubkey(owner_pubkey))?.id ?? null;

    if (!matchedUserId) {
      logger.warn("No user found for pubkey in /person", "SPHINX_PERSON", { owner_pubkey });
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.user.update({
      where: { id: matchedUserId },
      data: {
        sphinxAlias: owner_alias,
        sphinxRouteHint: owner_route_hint,
      },
    });

    logger.info("Updated user profile from /person", "SPHINX_PERSON", {
      userId: matchedUserId,
      owner_route_hint: owner_route_hint ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error in /person endpoint", "SPHINX_PERSON", { error });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
