import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
// import { db } from "@/lib/db";
import { createAppAuth } from "@octokit/auth-app";
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
  try {
    if (!privateKey.includes("-----BEGIN")) {
      decodedPrivateKey = Buffer.from(privateKey, "base64").toString("utf-8");
    }
  } catch {
    console.warn("Failed to decode private key as base64, using as-is");
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
    iss: appId,
  };

  return jwt.sign(payload, privateKey, { algorithm: "RS256" });
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
          // Get repositories accessible by this installation
          const installationOctokit = new Octokit({
            auth: createAppAuth({
              appId: config.appId,
              privateKey: config.privateKey,
              installationId: installation.id,
            }),
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
          console.warn(
            `Failed to check installation ${installation.id}:`,
            error,
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
        if (repositoryOwner) {
          installationUrl += `?suggested_target_id=${repositoryOwner}`;
        }
      } else {
        // App installed but needs repository access
        installationUrl = `${baseUrl}/${appSlug}/installations/${installationId}`;
      }

      // Add repository selection parameters if we have repo info
      if (repositoryName && repositoryOwner) {
        const separator = installationUrl.includes("?") ? "&" : "?";
        installationUrl += `${separator}repository_ids[]=${repositoryId || ""}`;
      }

      return NextResponse.json({
        status: "not_linked",
        installationUrl,
        message: isInstalled
          ? "App is installed but needs access to this repository"
          : "App needs to be installed on this account",
        installationId: isInstalled ? installationId : null,
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
