import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {

    console.log("🔴 Github app webhook received");

    logger.debug("🔴 Github app webhook headers", "webhook/route", { req.headers });

    logger.debug("🔴 Github app webhook body", "webhook/route", { req });

    const secret = process.env.GITHUB_WEBHOOK_SECRET!;
    const signature = req.headers.get("x-hub-signature-256") || "";
    const body = await req.text();

    // Verify signature
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(body).digest("hex")}`;

    if (signature !== digest) {
        return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
    }

    const event = req.headers.get("x-github-event");
    const payload = JSON.parse(body);

    if (event === "github_app_authorization" && payload.action === "revoked") {
        logger.debug("🔴 User revoked authorization:", "webhook/route", { payload.sender.login });
        // Delete user token from DB or cache
    }

    return NextResponse.json({ success: true });
}