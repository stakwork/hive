import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state");
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");

    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      // Redirect to login if not authenticated
      return NextResponse.redirect(new URL("/auth", request.url));
    }

    // Validate required parameters
    if (!state) {
      return NextResponse.redirect(new URL("/?error=missing_state", request.url));
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
