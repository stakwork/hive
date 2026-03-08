import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { EncryptionService } from "@/lib/encryption";
import { sendDirectMessage, isDirectMessageConfigured } from "@/lib/sphinx/direct-message";

export async function POST(request: NextRequest) {
  const encryptionService = EncryptionService.getInstance();
  try {
    const body = await request.json();
    const { owner_pubkey, owner_alias, owner_route_hint } = body;

    if (!owner_pubkey || typeof owner_pubkey !== "string") {
      logger.warn("Missing or invalid owner_pubkey in /person request", "SPHINX_PERSON");
      return NextResponse.json({ error: "owner_pubkey is required" }, { status: 400 });
    }

    // Find user by decrypting and comparing lightningPubkey fields
    const usersWithPubkey = await db.user.findMany({
      where: { lightningPubkey: { not: null } },
      select: { id: true, lightningPubkey: true },
    });

    let matchedUserId: string | null = null;

    for (const user of usersWithPubkey) {
      if (!user.lightningPubkey) continue;

      try {
        const encryptedData = JSON.parse(user.lightningPubkey);
        const decryptedPubkey = encryptionService.decryptField("lightningPubkey", encryptedData);

        if (decryptedPubkey === owner_pubkey) {
          matchedUserId = user.id;
          break;
        }
      } catch (decryptError) {
        logger.error("Failed to decrypt user pubkey", "SPHINX_PERSON", {
          error: decryptError,
          userId: user.id,
        });
      }
    }

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

    // Add contact + send welcome DM so the key exchange completes early,
    // well before any real notifications need to be delivered.
    if (owner_route_hint && isDirectMessageConfigured()) {
      sendDirectMessage(owner_pubkey, "Welcome to Hive!", {
        routeHint: owner_route_hint,
      }).catch((err) => {
        logger.error("Failed to send welcome DM", "SPHINX_PERSON", { error: err });
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error in /person endpoint", "SPHINX_PERSON", { error });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
