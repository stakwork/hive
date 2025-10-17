import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function checkRepositoryAccess(
  accessToken: string,
  repoUrl: string,
): Promise<{
  hasAccess: boolean;
  canPush: boolean;
  repositoryData?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    permissions?: Record<string, boolean>;
  };
  error?: string;
}> {
  try {
    // Extract owner/repo from URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return { hasAccess: false, canPush: false, error: "invalid_repository_url" };
    }

    const [, owner, repo] = githubMatch;

    // Check if we can access the repository
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Check push permissions
      const canPush =
        repositoryData.permissions?.push === true ||
        repositoryData.permissions?.admin === true ||
        repositoryData.permissions?.maintain === true;

      console.log(`Repository permissions for ${owner}/${repo}:`, repositoryData.permissions);
      console.log(`Can push: ${canPush}`);

      return {
        hasAccess: true,
        canPush: canPush,
        repositoryData: {
          name: repositoryData.name,
          full_name: repositoryData.full_name,
          private: repositoryData.private,
          default_branch: repositoryData.default_branch,
          permissions: repositoryData.permissions,
        },
      };
    } else if (response.status === 404) {
      return { hasAccess: false, canPush: false, error: "repository_not_found_or_no_access" };
    } else if (response.status === 403) {
      return { hasAccess: false, canPush: false, error: "access_forbidden" };
    } else {
      return { hasAccess: false, canPush: false, error: `http_error_${response.status}` };
    }
  } catch (error) {
    console.error("Error checking repository access:", error);
    return { hasAccess: false, canPush: false, error: "network_error" };
  }
}

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

    console.log("state--state--state");
    console.log(state);
    console.log("state--state--state");

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
    // const userSession = await db.session.findFirst({
    //   where: {
    //     userId: session.user.id as string,
    //     githubState: state,
    //   },
    // });

    // if (!userSession) {
    //   console.error("Invalid or expired GitHub state for user:", session.user.id);
    //   return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
    // }

    const { userAccessToken, userRefreshToken } = await getAccessToken(code, state);

    if (!userAccessToken) {
      return NextResponse.redirect(new URL("/?error=invalid_code", request.url));
    }

    // console.log("userAccessToken", userAccessToken);
    // console.log("userRefreshToken", userRefreshToken);

    // Get GitHub user info to determine which org/user this token belongs to
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(new URL("/?error=github_user_fetch_failed", request.url));
    }

    const githubUser = await userResponse.json();

    // Decode the state to get workspace information FIRST
    let workspaceSlug: string;
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      workspaceSlug = stateData.workspaceSlug;

      // Optional: Validate timestamp (e.g., state not older than 1 hour)
      const stateAge = Date.now() - stateData.timestamp;
      if (stateAge > 60 * 60 * 1000) {
        // 1 hour
        return NextResponse.redirect(new URL(`/?error=state_expired`, request.url));
      }
    } catch (error) {
      console.error("Failed to decode state:", error);
      return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
    }

    // Get installation info if available
    let githubOwner: string;
    let ownerType: "user" | "org" = "user";
    let installationIdNumber: number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let installationAccount: any = null;

    if (installationId) {
      // We have an installation - get the user's installations to find this one
      const installationsResponse = await fetch("https://api.github.com/user/installations", {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (installationsResponse.ok) {
        const installationsData = await installationsResponse.json();

        console.log("installationsData", installationsData);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const installation = installationsData.installations?.find((inst: any) => inst.id === parseInt(installationId));

        if (installation) {
          githubOwner = installation.account.login;
          ownerType = installation.account.type === "User" ? "user" : "org";
          installationIdNumber = parseInt(installationId);
          // Store installation account details for later use
          installationAccount = installation.account;
          console.log(`✅ Found installation: ${githubOwner} (${ownerType}), installation ID: ${installationIdNumber}`);
        } else {
          console.error(`❌ Installation ${installationId} not found in user's installations`);
          // Fallback to the authenticated user
          githubOwner = githubUser.login;
          ownerType = "user";
        }
      } else {
        console.error(
          `❌ Failed to fetch user installations:`,
          installationsResponse.status,
          installationsResponse.statusText,
        );
        // Fallback to the authenticated user
        githubOwner = githubUser.login;
        ownerType = "user";
      }
    } else {
      // No installation ID - this is just OAuth for existing installation
      // Look up the workspace to see which SourceControlOrg it's linked to
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: { sourceControlOrg: true },
      });

      if (workspace?.sourceControlOrg) {
        // Use the existing SourceControlOrg that the workspace is linked to
        githubOwner = workspace.sourceControlOrg.githubLogin;
        ownerType = workspace.sourceControlOrg.type === "USER" ? "user" : "org";
        console.log(`🔗 Workspace ${workspaceSlug} is linked to SourceControlOrg: ${githubOwner} (${ownerType})`);
      } else {
        // Workspace not linked yet - extract GitHub org from repository URL
        const workspace = await db.workspace.findUnique({
          where: { slug: workspaceSlug },
        });

        if (workspace) {

          // TODO: getting primary repository url from repositories, until it is created is incorrect
          const repoUrl = workspace.repositoryDraft;

          if (repoUrl) {
            const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)/);

            if (githubMatch) {
              const repoGithubOwner = githubMatch[1];
              console.log(`Extracted GitHub owner from repo URL: ${repoGithubOwner}`);

              const existingSourceControlOrg = await db.sourceControlOrg.findUnique({
                where: { githubLogin: repoGithubOwner },
              });

              if (existingSourceControlOrg) {
                githubOwner = repoGithubOwner;
                ownerType = existingSourceControlOrg.type === "USER" ? "user" : "org";
                console.log(
                  ` Found existing SourceControlOrg for ${repoGithubOwner}, reusing for workspace ${workspaceSlug}`,
                );
              } else {
                // No existing SourceControlOrg for this GitHub owner - this shouldn't happen in OAuth flow
                console.log(` No SourceControlOrg found for ${repoGithubOwner}, falling back to authenticated user`);
                githubOwner = githubUser.login;
                ownerType = "user";
              }
            } else {
              // Invalid repository URL - fallback to authenticated user
              console.log(`Could not extract GitHub owner from repo URL: ${repoUrl}`);
              githubOwner = githubUser.login;
              ownerType = "user";
            }
          } else {
            // No repository URL - fallback to authenticated user
            console.log(
              ` Workspace ${workspaceSlug} has no repository URL, using authenticated user: ${githubUser.login}`,
            );
            githubOwner = githubUser.login;
            ownerType = "user";
          }
        } else {
          console.log(` Workspace ${workspaceSlug} not found, using authenticated user: ${githubUser.login}`);
          githubOwner = githubUser.login;
          ownerType = "user";
        }
      }
    }

    console.log(`📋 Creating tokens for ${githubOwner} (${ownerType})`);

    // Encrypt the tokens before storing
    const encryptionService = EncryptionService.getInstance();
    const encryptedAccessToken = JSON.stringify(
      encryptionService.encryptField("source_control_token", userAccessToken),
    );
    let encryptedRefreshToken;
    let appExpiresAt;
    if (userRefreshToken) {
      encryptedRefreshToken = JSON.stringify(
        encryptionService.encryptField("source_control_refresh_token", userRefreshToken),
      );
      appExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours from now
    }

    // Find or create SourceControlOrg
    let sourceControlOrg = await db.sourceControlOrg.findUnique({
      where: { githubLogin: githubOwner },
    });

    if (!sourceControlOrg && installationIdNumber) {
      // Create new SourceControlOrg (only if we have installation ID)
      sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: ownerType === "user" ? "USER" : "ORG",
          githubLogin: githubOwner,
          githubInstallationId: installationIdNumber,
          name: installationAccount?.name || installationAccount?.display_name || githubOwner,
          avatarUrl: installationAccount?.avatar_url || null,
          description: installationAccount?.description || installationAccount?.bio || null,
        },
      });
      console.log(`✅ Created SourceControlOrg for ${githubOwner}`);
    } else if (!sourceControlOrg && !installationIdNumber) {
      // OAuth-only flow - SourceControlOrg should already exist
      return NextResponse.redirect(new URL(`/w/${workspaceSlug}?error=no_installation_found`, request.url));
    } else if (
      sourceControlOrg &&
      installationIdNumber &&
      sourceControlOrg.githubInstallationId !== installationIdNumber
    ) {
      // Update installation ID if it changed
      sourceControlOrg = await db.sourceControlOrg.update({
        where: { id: sourceControlOrg.id },
        data: { githubInstallationId: installationIdNumber },
      });
      console.log(`🔄 Updated installation ID for ${githubOwner}`);
    }

    // Ensure we have a sourceControlOrg at this point
    if (!sourceControlOrg) {
      console.error(`No SourceControlOrg found or created for ${githubOwner}`);
      return NextResponse.redirect(new URL(`/w/${workspaceSlug}?error=source_control_org_missing`, request.url));
    }

    // Create or update SourceControlToken
    const existingToken = await db.sourceControlToken.findUnique({
      where: {
        userId_sourceControlOrgId: {
          userId: session.user.id as string,
          sourceControlOrgId: sourceControlOrg.id,
        },
      },
    });

    if (existingToken) {
      // Update existing token
      await db.sourceControlToken.update({
        where: { id: existingToken.id },
        data: {
          token: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: appExpiresAt,
        },
      });
      console.log(`🔄 Updated SourceControlToken for user ${session.user.id} on ${githubOwner}`);
    } else {
      // Create new token
      await db.sourceControlToken.create({
        data: {
          userId: session.user.id as string,
          sourceControlOrgId: sourceControlOrg.id,
          token: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: appExpiresAt,
        },
      });
      console.log(`✅ Created SourceControlToken for user ${session.user.id} on ${githubOwner}`);
    }

    // Clear the GitHub state from the session after successful validation
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: null },
    });

    // Link the workspace to the source control org and check repository access
    let repositoryAccessStatus = "unknown";

    if (setupAction === "install" || setupAction === "update" || !setupAction) {
      console.log(`Linking workspace ${workspaceSlug} to SourceControlOrg ${githubOwner}`);

      // Find the workspace and link it to the source control org
      const result = await db.workspace.updateMany({
        where: { slug: workspaceSlug },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      console.log(`✅ Linked ${result.count} workspace(s) to SourceControlOrg ${githubOwner}`);

      // Check repository access after linking
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
      });

      // Try to get repository URL from localStorage data or primary repository
      let targetRepositoryUrl: string | undefined;

      if (workspace) {
        const primaryRepo = await getPrimaryRepository(workspace.id);
        targetRepositoryUrl = primaryRepo?.repositoryUrl;
      }

      // If no swarm yet, try to reconstruct from the state data
      if (!targetRepositoryUrl) {
        try {
          const stateData = JSON.parse(Buffer.from(state, "base64").toString());
          // If we stored repositoryUrl in state, use it (we should enhance the install route to include this)
          targetRepositoryUrl = stateData.repositoryUrl;
        } catch (error) {
          console.log("Could not extract repository URL from state", error);
        }
      }

      if (targetRepositoryUrl) {
        try {
          const repositoryAccess = await checkRepositoryAccess(userAccessToken, targetRepositoryUrl);

          if (repositoryAccess.hasAccess && repositoryAccess.canPush) {
            console.log(`✅ GitHub App has push access to repository: ${targetRepositoryUrl}`);
            repositoryAccessStatus = "accessible";
          } else if (repositoryAccess.hasAccess && !repositoryAccess.canPush) {
            console.log(`❌ GitHub App has read-only access to repository: ${targetRepositoryUrl}`);
            console.log("🚫 Blocking swarm setup - push permissions required");
            repositoryAccessStatus = "read_only_blocked";
          } else {
            console.log(`❌ GitHub App does not have access to repository: ${targetRepositoryUrl}`);
            console.log(`Error: ${repositoryAccess.error}`);
            console.log("🚫 Blocking swarm setup - no repository access");
            repositoryAccessStatus = repositoryAccess.error || "no_access";
          }
        } catch (error) {
          console.error("Error checking repository access:", error);
          console.log("🚫 Blocking swarm setup - permission check failed");
          repositoryAccessStatus = "check_failed";
        }
      } else {
        console.log("⚠️ No repository URL found to check access");
        console.log("🚫 Blocking swarm setup - no repository URL");
        repositoryAccessStatus = "no_repository_url";
      }
    } else if (setupAction === "uninstall") {
      console.log(`Unlinking workspace ${workspaceSlug} from SourceControlOrg`);

      // Unlink the workspace from source control org
      const result = await db.workspace.updateMany({
        where: { slug: workspaceSlug },
        data: { sourceControlOrgId: null },
      });

      console.log(`🔗 Unlinked ${result.count} workspace(s) from SourceControlOrg`);
    }

    // Redirect to the workspace page with setup action and repository access status
    const redirectUrl = new URL(`/w/${workspaceSlug}`, request.url);
    redirectUrl.searchParams.set("github_setup_action", setupAction || "connected");
    if (repositoryAccessStatus !== "unknown") {
      redirectUrl.searchParams.set("repository_access", repositoryAccessStatus);
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("GitHub App callback error:", error);
    return NextResponse.redirect(new URL("/?error=github_app_callback_error", request.url));
  }
}
