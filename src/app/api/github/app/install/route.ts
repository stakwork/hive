import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { checkAppInstalled } from "@/lib/githubApp";
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

    const body = await request.json();
    const workspaceSlug = body?.workspaceSlug;

    if (!workspaceSlug) {
      return NextResponse.json({ success: false, message: "Workspace slug is required" }, { status: 400 });
    }

    // Generate state
    const randomState = randomBytes(32).toString("hex");
    const stateData = {
      workspaceSlug,
      randomState,
      timestamp: Date.now(),
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Store the GitHub state in the user's session
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: state },
    });

    // Check if app is already installed on this workspace
    const { installed, installationId } = await checkAppInstalled(workspaceSlug);

    console.log("=> installed:", installed, "installationId:", installationId);

    let authUrl: string;
    let flowType: string;

    if (installed) {
      // App already installed - just need user authorization
      authUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_APP_CLIENT_ID}&state=${state}`;
      flowType = "user_authorization";
    } else {
      // App not installed - need full installation flow
      authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;
      flowType = "installation";
    }

    console.log("=> authUrl:", authUrl, "flowType:", flowType);

    return NextResponse.json(
      {
        success: true,
        data: {
          link: authUrl,
          state,
          flowType, // So frontend knows what's happening
          appInstalled: installed,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to generate GitHub App link", error);
    return NextResponse.json({ success: false, message: "Failed to generate GitHub link" }, { status: 500 });
  }
}
