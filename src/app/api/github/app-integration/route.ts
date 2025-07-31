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
      console.log("Decoded base64 private key");
    } else {
      console.log("Using private key as-is (already in PEM format)");
    }
  } catch (decodeError) {
    console.warn(
      "Failed to decode private key as base64, using as-is:",
      decodeError,
    );
  }

  // Sanitize and validate private key
  decodedPrivateKey = decodedPrivateKey.trim();

  // Check if the private key is properly formatted
  const hasBegin = decodedPrivateKey.startsWith("-----BEGIN");
  const hasEnd =
    decodedPrivateKey.endsWith("-----END RSA PRIVATE KEY-----") ||
    decodedPrivateKey.endsWith("-----END PRIVATE KEY-----");

  console.log("Private key validation:", {
    originalLength: privateKey.length,
    decodedLength: decodedPrivateKey.length,
    startsWithBegin: hasBegin,
    endsWithEnd: hasEnd,
    lastChars: decodedPrivateKey.slice(-30), // Show last 30 chars for debugging
  });

  // If the key doesn't end properly, try to fix it
  if (hasBegin && !hasEnd) {
    console.warn("Private key appears to be truncated or malformed");
    // Try to add the missing footer if it's clearly an RSA key
    if (
      decodedPrivateKey.includes("-----BEGIN RSA PRIVATE KEY-----") &&
      !decodedPrivateKey.endsWith("-----END RSA PRIVATE KEY-----")
    ) {
      if (!decodedPrivateKey.endsWith("\n")) {
        decodedPrivateKey += "\n";
      }
      decodedPrivateKey += "-----END RSA PRIVATE KEY-----";
      console.log("Added missing RSA private key footer");
    } else if (
      decodedPrivateKey.includes("-----BEGIN PRIVATE KEY-----") &&
      !decodedPrivateKey.endsWith("-----END PRIVATE KEY-----")
    ) {
      if (!decodedPrivateKey.endsWith("\n")) {
        decodedPrivateKey += "\n";
      }
      decodedPrivateKey += "-----END PRIVATE KEY-----";
      console.log("Added missing private key footer");
    }
  }

  if (
    !hasBegin ||
    (!decodedPrivateKey.endsWith("-----END RSA PRIVATE KEY-----") &&
      !decodedPrivateKey.endsWith("-----END PRIVATE KEY-----"))
  ) {
    throw new Error(
      "Invalid private key format. Private key must be in PEM format with proper headers and footers.",
    );
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

  console.log("JWT payload:", {
    iat: payload.iat,
    exp: payload.exp,
    iss: payload.iss,
    issType: typeof payload.iss,
  });

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

    console.log("Created GitHub App JWT:", {
      jwtLength: appJWT?.length,
      jwtType: typeof appJWT,
      jwtExists: !!appJWT,
      jwtStartsWith: appJWT?.substring(0, 20) + "...",
    });

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
          console.log(
            `Checking installation ${installation.id} for account ${installation.account?.login}`,
          );

          // Get repositories accessible by this installation
          const authConfig = {
            appId: parseInt(config.appId, 10),
            privateKey: config.privateKey,
            installationId: installation.id,
          };

          console.log("Auth config for installation:", {
            appId: authConfig.appId,
            appIdType: typeof authConfig.appId,
            installationId: authConfig.installationId,
            privateKeyExists: !!authConfig.privateKey,
            privateKeyType: typeof authConfig.privateKey,
          });

          // Create installation access token manually
          let installationOctokit;
          try {
            // First, create an installation access token using our JWT
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

            const installationTokenData =
              await installationTokenResponse.json();
            console.log("Successfully created installation access token");

            // Use the installation access token
            installationOctokit = new Octokit({
              auth: installationTokenData.token,
            });
          } catch (tokenError) {
            console.error(
              "Failed to create installation access token:",
              tokenError,
            );

            // Final fallback: try createAppAuth one more time
            try {
              installationOctokit = new Octokit({
                auth: createAppAuth(authConfig),
              });
            } catch (authError) {
              console.error("All authentication methods failed:", authError);
              throw authError;
            }
          }

          const repos =
            await installationOctokit.rest.apps.listReposAccessibleToInstallation();

          console.log("Installation repositories found:", {
            count: repos.data.repositories.length,
            repositories: repos.data.repositories.map((repo) => ({
              id: repo.id,
              name: repo.name,
              owner: repo.owner.login,
              fullName: repo.full_name,
            })),
          });

          console.log("Looking for target repository:", {
            repositoryId,
            repositoryIdType: typeof repositoryId,
            repositoryIdParsed: repositoryId ? parseInt(repositoryId) : null,
            repositoryName,
            repositoryOwner,
          });

          // Check if our target repository is in the list
          const targetRepo = repos.data.repositories.find((repo) => {
            if (repositoryId) {
              const matches = repo.id === parseInt(repositoryId);
              console.log(
                `Comparing repo ${repo.id} (${repo.full_name}) with target ${repositoryId}: ${matches}`,
              );
              return matches;
            }
            const matches =
              repo.name === repositoryName &&
              repo.owner.login === repositoryOwner;
            console.log(
              `Comparing repo ${repo.owner.login}/${repo.name} with target ${repositoryOwner}/${repositoryName}: ${matches}`,
            );
            return matches;
          });

          console.log(
            "Target repository found:",
            !!targetRepo,
            targetRepo ? targetRepo.full_name : "none",
          );

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
          // If this is an auth error, log more details
          if (error instanceof Error && error.message.includes("Token")) {
            console.error("Auth error details:", {
              appId: config.appId,
              appIdType: typeof config.appId,
              installationId: installation.id,
              installationIdType: typeof installation.id,
              privateKeyExists: !!config.privateKey,
              privateKeyLength: config.privateKey?.length,
            });
          }
          continue;
        }
      }

      console.log("Final decision variables:", {
        isInstalled,
        repositoryAccessGranted,
        installationId,
        bothConditionsMet: isInstalled && repositoryAccessGranted,
      });

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
            console.log(`Found user ID for ${repositoryOwner}: ${targetId}`);
          } else {
            console.warn(
              `Failed to get user ID for ${repositoryOwner}, using username`,
            );
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

      console.log("installationUrl", installationUrl);

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
