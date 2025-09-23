import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
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

    // Get workspace's repository URL to determine which GitHub org to check
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: { swarm: true },
    });

    if (!workspace?.swarm?.repositoryUrl) {
      return NextResponse.json(
        { success: false, message: "No repository URL found for this workspace" },
        { status: 400 },
      );
    }

    // Extract GitHub org/user from repository URL
    const repoUrl = workspace.swarm.repositoryUrl;
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)/);

    if (!githubMatch) {
      return NextResponse.json({ success: false, message: "Invalid GitHub repository URL" }, { status: 400 });
    }

    const githubOwner = githubMatch[1];
    console.log(`🔍 Checking GitHub app installation for owner: ${githubOwner}`);

    // Use the new installation check logic
    let installed = false;
    let installationId: number | undefined;
    let ownerType: "user" | "org" | undefined;

    // Get user's app tokens for this specific GitHub org to make the installation check
    const appTokens = await getUserAppTokens(session.user.id, githubOwner);
    if (appTokens?.accessToken) {
      // User has app tokens, so we can check installation status
      try {
        // Check if owner is user or org
        const userResponse = await fetch(`https://api.github.com/users/${githubOwner}`, {
          headers: {
            Authorization: `Bearer ${appTokens.accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          ownerType = userData.type === "User" ? "user" : "org";
          console.log(`📋 ${githubOwner} is a ${userData.type}`);

          // Check installation based on type
          let installationResponse;
          if (ownerType === "org") {
            installationResponse = await fetch(`https://api.github.com/orgs/${githubOwner}/installation`, {
              headers: {
                Authorization: `Bearer ${appTokens.accessToken}`,
                Accept: "application/vnd.github.v3+json",
              },
            });
          } else {
            installationResponse = await fetch(`https://api.github.com/users/${githubOwner}/installation`, {
              headers: {
                Authorization: `Bearer ${appTokens.accessToken}`,
                Accept: "application/vnd.github.v3+json",
              },
            });
          }

          if (installationResponse?.ok) {
            const installationData = await installationResponse.json();
            installed = true;
            installationId = installationData.id;
            console.log(`✅ App installed on ${githubOwner}! Installation ID: ${installationId}`);
          } else {
            console.log(`❌ App not installed on ${githubOwner} (status: ${installationResponse?.status})`);
          }
        }
      } catch (error) {
        console.error(`Error checking installation for ${githubOwner}:`, error);
      }
    } else {
      // User has no app tokens yet, so we assume app is not installed
      console.log(`👤 User has no app tokens, assuming app not installed for ${githubOwner}`);
    }

    let authUrl: string;
    let flowType: string;

    if (installed) {
      // App already installed - just need user authorization
      authUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_APP_CLIENT_ID}&state=${state}`;
      flowType = "user_authorization";
    } else {
      console.log(`👤 App not installed for ${githubOwner}`);
      // App not installed - need full installation flow
      if (ownerType === "user") {
        // For user repos, force installation on user account
        authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}&target_type=User`;
      } else {
        // For org repos, let user choose context
        authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;
      }
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
          githubOwner, // Which org/user we're connecting to
          ownerType, // 'user' or 'org'
          installationId, // Installation ID if already installed
          repositoryUrl: repoUrl, // The repository URL from workspace
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to generate GitHub App link", error);
    return NextResponse.json({ success: false, message: "Failed to generate GitHub link" }, { status: 500 });
  }
}
