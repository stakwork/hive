import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";

export const runtime = "nodejs";

async function getAccessToken(code: string, state: string) {
  // console.log("getAccessToken", code, state);
  // 2. Exchange the temporary code for an OAuth token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_CLIENT_ID,
      client_secret: config.GITHUB_APP_CLIENT_SECRET,
      code,
      state,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`HTTP error! status: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  const userAccessToken = tokenData.access_token;
  const userRefreshToken = tokenData.refresh_token;

  return { userAccessToken, userRefreshToken };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // GH app must have:
    // Request user authorization (OAuth) during installation
    // and a single callback URL only

    // Log EVERYTHING GitHub sends you
    // console.log("=== ALL SEARCH PARAMS ===");
    // for (const [key, value] of searchParams.entries()) {
    //   console.log(`${key}: ${value}`);
    // }

    const state = searchParams.get("state");
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");
    const code = searchParams.get("code");

    console.log("installationId", installationId);
    console.log("setupAction", setupAction);
    console.log("code", code);

    // Validate required parameters
    if (!state) {
      return NextResponse.redirect(new URL("/?error=missing_state", request.url));
    }
    if (!code) {
      console.log("missing code!!!!");
      return NextResponse.redirect(new URL("/?error=missing_code", request.url));
    }

    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      // Redirect to login if not authenticated
      return NextResponse.redirect(new URL("/auth", request.url));
    }

    // Get the user's session to validate the GitHub state
    const userSession = await db.session.findFirst({
      where: {
        userId: session.user.id as string,
        githubState: state,
      },
    });

    if (!userSession) {
      console.error("Invalid or expired GitHub state for user:", session.user.id);
      return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
    }

    const { userAccessToken, userRefreshToken } = await getAccessToken(code, state);

    if (!userAccessToken || !userRefreshToken) {
      return NextResponse.redirect(new URL("/?error=invalid_code", request.url));
    }

    // console.log("userAccessToken", userAccessToken);
    // console.log("userRefreshToken", userRefreshToken);

    // Encrypt the tokens before storing
    const encryptionService = EncryptionService.getInstance();
    const encryptedAccessToken = JSON.stringify(encryptionService.encryptField("app_access_token", userAccessToken));
    const encryptedRefreshToken = JSON.stringify(encryptionService.encryptField("app_refresh_token", userRefreshToken));

    // Find existing GitHub account for this user
    const existingAccount = await db.account.findFirst({
      where: {
        userId: session.user.id as string,
        provider: "github",
      },
    });

    if (existingAccount) {
      // Update existing account with new app tokens
      await db.account.update({
        where: {
          id: existingAccount.id,
        },
        data: {
          app_access_token: encryptedAccessToken,
          app_refresh_token: encryptedRefreshToken,
          app_expires_at: Math.floor(Date.now() / 1000) + 8 * 60 * 60, // 8 hours from now
        },
      });
    } else {
      // Create new account with app tokens
      await db.account.create({
        data: {
          userId: session.user.id as string,
          type: "oauth",
          provider: "github",
          providerAccountId: session.user.id as string, // Use session user ID as fallback
          app_access_token: encryptedAccessToken,
          app_refresh_token: encryptedRefreshToken,
          app_expires_at: Math.floor(Date.now() / 1000) + 8 * 60 * 60, // 8 hours from now
        },
      });
    }

    // Decode the state to get workspace information
    let workspaceSlug: string;
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      workspaceSlug = stateData.workspaceSlug;

      // Optional: Validate timestamp (e.g., state not older than 1 hour)
      const stateAge = Date.now() - stateData.timestamp;
      if (stateAge > 60 * 60 * 1000) {
        // 1 hour
        return NextResponse.redirect(new URL(`/w/${workspaceSlug}?error=state_expired`, request.url));
      }
    } catch (error) {
      console.error("Failed to decode state:", error);
      return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
    }

    // Clear the GitHub state from the session after successful validation
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: null },
    });

    // If we have an installation ID, save it to the swarm
    if (installationId && (setupAction === "install" || setupAction === "update")) {
      console.log(`Saving GitHub App installation ID ${installationId} to workspace ${workspaceSlug}`);

      // Find the workspace by slug and update its swarm
      const result = await db.swarm.updateMany({
        where: {
          workspace: {
            slug: workspaceSlug,
          },
        },
        data: { githubInstallationId: installationId },
      });

      console.log(`Updated ${result.count} swarm(s) with GitHub installation ID`);
    } else if (setupAction === "uninstall") {
      console.log(`Clearing GitHub App installation ID from workspace ${workspaceSlug}`);

      // Clear the installation ID if uninstalled
      const result = await db.swarm.updateMany({
        where: {
          workspace: {
            slug: workspaceSlug,
          },
        },
        data: { githubInstallationId: null },
      });

      console.log(`Cleared GitHub installation ID from ${result.count} swarm(s)`);
    }

    // Redirect to the workspace page with just the setup action
    return NextResponse.redirect(new URL(`/w/${workspaceSlug}?github_setup_action=${setupAction}`, request.url));
  } catch (error) {
    console.error("GitHub App callback error:", error);
    return NextResponse.redirect(new URL("/?error=github_app_callback_error", request.url));
  }
}
