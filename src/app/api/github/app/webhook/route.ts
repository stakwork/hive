import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    console.log("🔴 GitHub app webhook received");

    // Validate webhook secret is configured
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error("GITHUB_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { message: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    // Get headers
    const signature = req.headers.get("x-hub-signature-256") || "";
    const event = req.headers.get("x-github-event");

    // Read and verify body
    const body = await req.text();

    // Verify signature using timing-safe comparison
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(body).digest("hex")}`;

    // Timing-safe comparison
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      console.warn("Invalid webhook signature received");
      return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
    }

    // Parse payload
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      console.error("Failed to parse webhook payload:", error);
      return NextResponse.json(
        { message: "Invalid payload: malformed JSON" },
        { status: 400 }
      );
    }

    console.log(`GitHub app webhook event: ${event}, action: ${payload.action}`);

    // Handle authorization revocation
    if (event === "github_app_authorization" && payload.action === "revoked") {
      const username = payload.sender?.login;
      console.log("🔴 User revoked authorization:", username);

      if (username) {
        try {
          // Find all SourceControlOrgs matching the GitHub login
          const sourceControlOrgs = await db.sourceControlOrg.findMany({
            where: {
              githubLogin: username,
            },
          });

          if (sourceControlOrgs.length > 0) {
            // Delete all tokens associated with these orgs
            const orgIds = sourceControlOrgs.map((org) => org.id);
            const deleteResult = await db.sourceControlToken.deleteMany({
              where: {
                sourceControlOrgId: {
                  in: orgIds,
                },
              },
            });

            console.log(
              `Deleted ${deleteResult.count} tokens for user ${username}`
            );
          } else {
            console.log(`No source control orgs found for user ${username}`);
          }
        } catch (error) {
          console.error("Error deleting tokens on revocation:", error);
          return NextResponse.json(
            { message: "Failed to process revocation" },
            { status: 500 }
          );
        }
      }
    }

    // Handle installation events
    if (event === "installation") {
      const action = payload.action;
      const installationId = payload.installation?.id;
      console.log(`Installation ${action} for installation ${installationId}`);
      
      // Future enhancement: Update SourceControlOrg status based on action
      // (created, deleted, suspend, unsuspend)
    }

    // Handle installation_repositories events
    if (event === "installation_repositories") {
      const action = payload.action;
      const installationId = payload.installation?.id;
      const addedCount = payload.repositories_added?.length || 0;
      const removedCount = payload.repositories_removed?.length || 0;
      
      console.log(
        `Installation repositories ${action}: ${addedCount} added, ${removedCount} removed for installation ${installationId}`
      );
      
      // Future enhancement: Update workspace repository permissions
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unexpected error processing GitHub app webhook:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}