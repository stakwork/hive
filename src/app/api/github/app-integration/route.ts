import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { Octokit } from "@octokit/rest";
import jwt from "jsonwebtoken";

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

function getGitHubAppConfig(): GitHubAppConfig {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;

  if (!appId || !privateKey || !clientId || !clientSecret) {
    throw new Error("GitHub App credentials not configured");
  }

  // Decode base64 private key if needed
  let decodedPrivateKey = privateKey;
  if (!privateKey.includes("-----BEGIN")) {
    decodedPrivateKey = Buffer.from(privateKey, "base64").toString("utf-8");
  }

  return {
    appId,
    privateKey: decodedPrivateKey,
    clientId,
    clientSecret,
  };
}

async function createGitHubAppJWT(
  appId: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago
    exp: now + 600, // Expires in 10 minutes
    iss: appId, // GitHub expects this as a string
  };

  const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });

  if (!token || typeof token !== "string") {
    throw new Error(
      `JWT creation failed: got ${typeof token} instead of string`,
    );
  }

  return token;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { repositoryId, repositoryName, repositoryOwner } = body;

    if (!repositoryId && (!repositoryName || !repositoryOwner)) {
      return NextResponse.json(
        { error: "Repository ID or repository name/owner required" },
        { status: 400 },
      );
    }

    const config = getGitHubAppConfig();

    // Create GitHub App JWT
    const appJWT = await createGitHubAppJWT(config.appId, config.privateKey);

    // Create Octokit instance with App authentication
    const octokit = new Octokit({
      auth: appJWT,
    });

    try {
      // Get app installations
      const installations = await octokit.rest.apps.listInstallations();

      let isInstalled = false;
      let installationId: number | null = null;
      let repositoryAccessGranted = false;

      // Check each installation
      for (const installation of installations.data) {
        try {
          // Create installation access token
          const installationTokenResponse = await fetch(
            `https://api.github.com/app/installations/${installation.id}/access_tokens`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${appJWT}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            },
          );

          if (!installationTokenResponse.ok) {
            throw new Error(
              `Failed to create installation token: ${installationTokenResponse.status} ${installationTokenResponse.statusText}`,
            );
          }

          const installationTokenData = await installationTokenResponse.json();

          // Use the installation access token
          const installationOctokit = new Octokit({
            auth: installationTokenData.token,
          });

          const repos =
            await installationOctokit.rest.apps.listReposAccessibleToInstallation();

          // Check if our target repository is in the list
          const targetRepo = repos.data.repositories.find((repo) => {
            if (repositoryId) {
              return repo.id === parseInt(repositoryId);
            }
            return (
              repo.name === repositoryName &&
              repo.owner.login === repositoryOwner
            );
          });

          if (targetRepo) {
            isInstalled = true;
            installationId = installation.id;
            repositoryAccessGranted = true;
            break;
          } else if (installation.account?.login === repositoryOwner) {
            // App is installed on the account but doesn't have access to this specific repo
            isInstalled = true;
            installationId = installation.id;
            repositoryAccessGranted = false;
            break;
          }
        } catch (error) {
          console.error(
            `Failed to check installation ${installation.id}:`,
            error instanceof Error ? error.message : error,
          );
          continue;
        }
      }

      if (isInstalled && repositoryAccessGranted) {
        return NextResponse.json({
          status: "linked",
          installationId,
          message: "Repository is already linked to the GitHub App",
        });
      }

      // Generate installation URL
      const baseUrl = "https://github.com/apps";
      const appSlug = process.env.GITHUB_APP_SLUG || "your-app-name"; // You'll need to add this to env

      let installationUrl: string;

      if (!isInstalled) {
        // App not installed on account - direct to app installation
        installationUrl = `${baseUrl}/${appSlug}/installations/new`;
      } else {
        // App installed but needs repository access
        installationUrl = `${baseUrl}/${appSlug}/installations/${installationId}`;
      }

      // Add repository selection parameters if we have repo info
      if (repositoryName && repositoryOwner && repositoryId) {
        try {
          // Get the user ID for the repository owner to use as suggested_target_id
          const userResponse = await fetch(
            `https://api.github.com/users/${repositoryOwner}`,
            {
              headers: {
                Authorization: `Bearer ${appJWT}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            },
          );

          let targetId = repositoryOwner; // fallback to username
          if (userResponse.ok) {
            const userData = await userResponse.json();
            targetId = userData.id.toString();
          }

          const params = new URLSearchParams();

          // Add suggested target (repository owner ID) and repository ID for auto-selection
          params.append("suggested_target_id", targetId);
          params.append("repository_ids[]", repositoryId.toString());

          // Add additional parameters to help with account selection
          // params.append("return_to", ""); // Removed server-side window reference

          installationUrl += `?${params.toString()}`;
        } catch (error) {
          console.error("Error getting user ID:", error);
          // Fallback to simple parameters
          const params = new URLSearchParams();
          params.append("suggested_target_id", repositoryOwner);
          params.append("repository_ids[]", repositoryId.toString());
          installationUrl += `?${params.toString()}`;
        }
      }

      // Provide alternative URLs for different account contexts
      const alternativeUrls = {
        directUserInstall: `https://github.com/settings/installations`,
        appMarketplace: `https://github.com/marketplace/${appSlug}`,
        manualInstall: `https://github.com/apps/${appSlug}`,
      };

      return NextResponse.json({
        status: "not_linked",
        installationUrl,
        alternativeUrls,
        message: isInstalled
          ? "App is installed but needs access to this repository"
          : "App needs to be installed on this account",
        installationId: isInstalled ? installationId : null,
        instructions: !isInstalled
          ? "If the popup opens in the wrong account context, try: 1) Go to your personal GitHub Settings > Applications > Installed GitHub Apps, 2) Click 'Install' or visit the app's marketplace page"
          : undefined,
      });
    } catch (githubError) {
      console.error("GitHub API error:", githubError);

      // If it's a 404, the app might not be installed
      if (
        githubError &&
        typeof githubError === "object" &&
        "status" in githubError &&
        githubError.status === 404
      ) {
        const appSlug = process.env.GITHUB_APP_SLUG || "your-app-name";
        const installationUrl = `https://github.com/apps/${appSlug}/installations/new`;

        return NextResponse.json({
          status: "not_linked",
          installationUrl,
          message: "App is not installed on any accounts",
          installationId: null,
        });
      }

      throw githubError;
    }
  } catch (error: unknown) {
    console.error("Error checking GitHub App integration:", error);

    let errorMessage = "Failed to check GitHub App integration";
    let statusCode = 500;

    if (error && typeof error === "object" && "message" in error) {
      errorMessage = error.message as string;

      if (errorMessage.includes("GitHub App credentials not configured")) {
        statusCode = 503; // Service Unavailable
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
