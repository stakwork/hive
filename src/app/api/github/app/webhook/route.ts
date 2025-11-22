import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    console.log("🔴 Github app webhook received");

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error("GITHUB_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { message: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    const signature = req.headers.get("x-hub-signature-256") || "";
    const body = await req.text();

    // Verify signature using timing-safe comparison
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(body).digest("hex")}`;

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      console.warn("Invalid webhook signature received");
      return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
    }

    const event = req.headers.get("x-github-event");
    let payload;

    try {
      payload = JSON.parse(body);
    } catch (error) {
      console.error("Failed to parse webhook payload:", error);
      return NextResponse.json(
        { message: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // Handle github_app_authorization events
    if (event === "github_app_authorization" && payload.action === "revoked") {
      const senderLogin = payload.sender?.login;

      if (!senderLogin) {
        console.warn("Revoked event missing sender login");
        return NextResponse.json(
          { message: "Invalid payload: missing sender" },
          { status: 400 }
        );
      }

      console.log(`🔴 User revoked authorization: ${senderLogin}`);

      try {
        // Delete all tokens for this GitHub user
        const deletedTokens = await db.sourceControlToken.deleteMany({
          where: {
            sourceControlOrg: {
              githubLogin: senderLogin,
            },
          },
        });

        console.log(
          `Deleted ${deletedTokens.count} token(s) for user ${senderLogin}`
        );

        return NextResponse.json({
          success: true,
          message: "Authorization revoked",
          deletedTokens: deletedTokens.count,
        });
      } catch (error) {
        console.error("Failed to delete tokens:", error);
        return NextResponse.json(
          { message: "Failed to process revocation" },
          { status: 500 }
        );
      }
    }

    // Acknowledge other events
    return NextResponse.json({ success: true, message: "Event received" });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}