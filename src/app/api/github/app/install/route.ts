import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { getUserAppTokens } from "@/lib/githubApp";
import { randomBytes } from "crypto";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
    const repositoryUrl = body?.repositoryUrl;

    if (!workspaceSlug) {
      return NextResponse.json({ success: false, message: "Workspace slug is required" }, { status: 400 });
    }

    // Generate state
    const randomState = randomBytes(32).toString("hex");
    const stateData = {
      workspaceSlug,
      repositoryUrl, // Include repository URL in state for callback
      randomState,
      timestamp: Date.now(),
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Store the GitHub state in the user's session
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: state },
    });

    // Get workspace and optionally its swarm (only if repositoryUrl param not provided)
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: {
        swarm: !repositoryUrl, // Only include swarm if repositoryUrl not provided
        sourceControlOrg: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 },
      );
    }

    // Get repository URL from parameter or workspace swarm
    const repoUrl = repositoryUrl || workspace?.swarm?.repositoryUrl;

    if (!repoUrl) {
      return NextResponse.json(
        { success: false, message: "No repository URL found for this workspace" },
        { status: 400 },
      );
    }
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

    // First, check if we have a SourceControlOrg record for this GitHub owner
    // This tells us if ANY user has installed the app for this org/user
    const existingSourceControlOrg = await db.sourceControlOrg.findUnique({
      where: { githubLogin: githubOwner },
    });

    console.log('existingSourceControlOrg--existingSourceControlOrg')
    console.log(existingSourceControlOrg)
    console.log('existingSourceControlOrg--existingSourceControlOrg')

    if (existingSourceControlOrg?.githubInstallationId) {
      // App is already installed by some user
      installed = true;
      installationId = existingSourceControlOrg.githubInstallationId;
      ownerType = existingSourceControlOrg.type === "USER" ? "user" : "org";
      console.log(`✅ App already installed on ${githubOwner}! Installation ID: ${installationId} (from database)`);
    } else {
      // No installation record found, try to check via API if this user has tokens
      const appTokens = await getUserAppTokens(session.user.id, githubOwner);
      if (appTokens?.accessToken) {
        // User has app tokens, so we can check installation status via API
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
              console.log(`✅ App installed on ${githubOwner}! Installation ID: ${installationId} (from API)`);
            } else {
              console.log(`❌ App not installed on ${githubOwner} (status: ${installationResponse?.status})`);
            }
          }
        } catch (error) {
          console.error(`Error checking installation for ${githubOwner}:`, error);
        }
      } else {
        // This is a new user with no tokens yet, but that doesn't mean the app isn't installed
        // We just couldn't verify it. For safety, we'll assume it needs installation
        console.log(`👤 User has no app tokens for ${githubOwner}, cannot verify installation status`);
      }
    }

    let authUrl: string;
    let flowType: string;

    if (installed) {
      // App is installed, but we need to check if it has access to this specific repository
      // First try to check repository access with existing tokens
      let hasRepoAccess = false;

      if (installationId) {
        try {
          const appTokens = await getUserAppTokens(session.user.id, githubOwner);
          if (appTokens?.accessToken) {
            const [, repoOwner, repoName] = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/) || [];
            if (repoOwner && repoName) {
              // Use installation-specific API to check repository access
              const installationReposResponse = await fetch(`https://api.github.com/user/installations/${installationId}/repositories`, {
                headers: {
                  Accept: "application/vnd.github+json",
                  Authorization: `Bearer ${appTokens.accessToken}`,
                  "X-GitHub-Api-Version": "2022-11-28",
                },
              });

              if (installationReposResponse.ok) {
                const installationData = await installationReposResponse.json();
                const targetRepoFullName = `${repoOwner}/${repoName}`.toLowerCase();

                // Check if the target repository is accessible through this installation
                const repositoryAccess = installationData.repositories?.find(
                  (repository: { full_name: string; permissions?: any }) =>
                    repository.full_name.toLowerCase() === targetRepoFullName
                );

                if (repositoryAccess) {
                  hasRepoAccess = !!(
                    repositoryAccess.permissions?.push ||
                    repositoryAccess.permissions?.admin ||
                    repositoryAccess.permissions?.maintain
                  );
                }
              }
            }
          }
        } catch (error) {
          console.error("Error checking repository access:", error);
        }
      }

      if (hasRepoAccess) {
        // App has access to the repository - just need user authorization
        authUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_APP_CLIENT_ID}&state=${state}`;
        flowType = "user_authorization";
      } else {
        // App installed but no repository access - redirect to general installation page
        // This allows users to modify repository access and supports state parameter
        authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;
        flowType = "repository_configuration";
      }
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
