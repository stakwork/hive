import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

async function POST(req: NextRequest) {

    console.log("🔴 Github app webhook received");

    console.log("🔴 Github app webhook headers", req.headers);

    console.log("🔴 Github app webhook body", req);

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
        console.log("🔴 User revoked authorization:", payload.sender.login);
        // Delete user token from DB or cache
    }

    return NextResponse.json({ success: true });
}

export { POST };