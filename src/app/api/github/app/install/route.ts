import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!config.GITHUB_APP_SLUG) {
      return NextResponse.json({ success: false, message: "GitHub App not configured" }, { status: 500 });
    }

    // Get workspace slug from request body
    const body = await request.json();
    const workspaceSlug = body?.workspaceSlug;

    if (!workspaceSlug) {
      return NextResponse.json({ success: false, message: "Workspace slug is required" }, { status: 400 });
    }

    // Generate a secure random state string
    const randomState = randomBytes(32).toString("hex");

    // Encode workspace slug and random state into a single state parameter
    const stateData = {
      workspaceSlug,
      randomState,
      timestamp: Date.now(),
    };

    // Base64 encode the state data
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Store the GitHub state in the user's session
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: state },
    });

    // Only set redirect_uri if we're running on localhost
    const host = request.headers.get("host") || "";
    const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");

    let installationUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;

    if (isLocalhost) {
      const redirectUrl = `http://localhost:3000/api/github/app/callback`;
      installationUrl += `&redirect_uri=${encodeURIComponent(redirectUrl)}`;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          link: installationUrl,
          state,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to generate GitHub App installation link", error);
    return NextResponse.json({ success: false, message: "Failed to generate installation link" }, { status: 500 });
  }
}
