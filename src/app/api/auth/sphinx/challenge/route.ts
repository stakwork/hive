import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/sphinx/challenge
 * 
 * Generates a new Sphinx authentication challenge with QR code and deep link.
 * The challenge is stored in the database with a 5-minute expiration.
 * 
 * @returns JSON with challenge k1, deep link, and QR code data URL
 */
export async function POST(request: NextRequest) {
  try {
    // Generate random 32-byte challenge (64 hex characters)
    const k1 = randomBytes(32).toString("hex");

    // Calculate expiration time (5 minutes from now)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Get current timestamp for deep link
    const timestamp = Date.now();

    // Get host from environment
    const host = process.env.NEXTAUTH_URL;
    if (!host) {
      logger.error("NEXTAUTH_URL environment variable not set", "SPHINX_AUTH");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Create deep link for Sphinx app
    const deepLink = `sphinx.chat://?action=auth&host=${encodeURIComponent(
      host
    )}&challenge=${k1}&ts=${timestamp}`;

    // Generate QR code as base64 PNG data URL
    let qrCode: string;
    try {
      qrCode = await QRCode.toDataURL(deepLink, {
        errorCorrectionLevel: "M",
        type: "image/png",
        width: 300,
        margin: 2,
      });
    } catch (qrError) {
      logger.error("Failed to generate QR code", "SPHINX_AUTH", { error: qrError });
      return NextResponse.json(
        { error: "Failed to generate QR code" },
        { status: 500 }
      );
    }

    // Store challenge in database
    try {
      await db.sphinxChallenge.create({
        data: {
          k1,
          used: false,
          expiresAt,
        },
      });
    } catch (dbError) {
      logger.error("Failed to create challenge in database", "SPHINX_AUTH", {
        error: dbError,
        k1,
      });
      return NextResponse.json(
        { error: "Failed to create challenge" },
        { status: 500 }
      );
    }

    logger.info("Sphinx challenge created", "SPHINX_AUTH", {
      challenge: k1,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json({
      challenge: k1,
      deepLink,
      qrCode,
    });
  } catch (error) {
    logger.error("Error in Sphinx challenge endpoint", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
