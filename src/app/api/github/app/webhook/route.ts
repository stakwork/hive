import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/encryption";

export async function POST(req: NextRequest) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
        return new Response("Webhook secret not configured", { status: 500 });
    }

    const signature = req.headers.get("x-hub-signature-256") || "";
    const body = await req.text();

    // Verify signature
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(body).digest("hex")}`;

    if (!timingSafeEqual(digest, signature)) {
        return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
    }

    console.log("🔴 Github app webhook received");

    const event = req.headers.get("x-github-event");
    const payload = JSON.parse(body);

    if (event === "github_app_authorization" && payload.action === "revoked") {
        console.log("🔴 User revoked authorization:", payload.sender.login);
        // Delete user token from DB or cache
    }

    return NextResponse.json({ success: true });
}
