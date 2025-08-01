import { App } from "@octokit/app";

// GitHub App configuration
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET;
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG;

if (
  !GITHUB_APP_ID ||
  !GITHUB_APP_PRIVATE_KEY ||
  !GITHUB_APP_CLIENT_ID ||
  !GITHUB_APP_CLIENT_SECRET ||
  !GITHUB_APP_SLUG
) {
  console.warn("GitHub App environment variables are not fully configured");
}

// Create GitHub App instance
export const githubApp =
  GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY
    ? new App({
        appId: GITHUB_APP_ID,
        privateKey: Buffer.from(GITHUB_APP_PRIVATE_KEY, "base64").toString(
          "utf-8",
        ),
      })
    : null;

export interface GitHubAppInstallation {
  id: number;
  account: {
    login: string;
    type: string;
    avatar_url: string;
  };
  repository_selection: string;
  permissions: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    type: string;
  };
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
}

/**
 * Generate GitHub App installation URL for a specific repository
 */
export function generateInstallationUrl(repositoryFullName: string): string {
  if (!GITHUB_APP_SLUG) {
    throw new Error("GITHUB_APP_SLUG is not configured");
  }

  const [owner, repo] = repositoryFullName.split("/");
  const callbackUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/github/callback`;
  return `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?repository=${repo}&owner=${owner}&return_to=${encodeURIComponent(callbackUrl)}`;
}

/**
 * Generate GitHub App installation URL for an organization or user
 */
export function generateInstallationUrlForOwner(owner: string): string {
  if (!GITHUB_APP_SLUG) {
    throw new Error("GITHUB_APP_SLUG is not configured");
  }

  const callbackUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/github/callback`;
  return `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?suggested_target_id=${owner}&return_to=${encodeURIComponent(callbackUrl)}`;
}

/**
 * Get all installations for the GitHub App
 */
export async function getAppInstallations(): Promise<GitHubAppInstallation[]> {
  if (!githubApp) {
    throw new Error("GitHub App is not configured");
  }

  try {
    const installations = await githubApp.octokit.request(
      "GET /app/installations",
    );
    return installations.data.map((installation) => ({
      id: installation.id,
      account: {
        login: installation.account?.login || "",
        type: installation.account?.type || "",
        avatar_url: installation.account?.avatar_url || "",
      },
      repository_selection: installation.repository_selection || "all",
      permissions: installation.permissions || {},
      created_at: installation.created_at,
      updated_at: installation.updated_at,
    }));
  } catch (error) {
    console.error("Error fetching app installations:", error);
    throw error;
  }
}

/**
 * Get installation access token for a specific installation
 */
export async function getInstallationAccessToken(
  installationId: number,
): Promise<string> {
  if (!githubApp) {
    throw new Error("GitHub App is not configured");
  }

  try {
    const installationOctokit =
      await githubApp.getInstallationOctokit(installationId);
    const { data } = await installationOctokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
      },
    );
    return data.token;
  } catch (error) {
    console.error("Error creating installation access token:", error);
    throw error;
  }
}

/**
 * Get repositories accessible to a specific installation
 */
export async function getInstallationRepositories(
  installationId: number,
): Promise<GitHubRepository[]> {
  if (!githubApp) {
    throw new Error("GitHub App is not configured");
  }

  try {
    const installationOctokit =
      await githubApp.getInstallationOctokit(installationId);
    const { data } = await installationOctokit.request(
      "GET /installation/repositories",
    );

    return data.repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: {
        login: repo.owner.login,
        type: repo.owner.type,
      },
      private: repo.private,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      default_branch: repo.default_branch,
    }));
  } catch (error) {
    console.error("Error fetching installation repositories:", error);
    throw error;
  }
}

/**
 * Check if a repository is installed for the GitHub App
 */
export async function isRepositoryInstalled(
  repositoryFullName: string,
): Promise<{
  installed: boolean;
  installationId?: number;
}> {
  if (!githubApp) {
    return { installed: false };
  }

  try {
    const installations = await getAppInstallations();

    for (const installation of installations) {
      try {
        const repositories = await getInstallationRepositories(installation.id);
        const isInstalled = repositories.some(
          (repo) => repo.full_name === repositoryFullName,
        );

        if (isInstalled) {
          return { installed: true, installationId: installation.id };
        }
      } catch {
        // Skip this installation if we can't access its repositories
        continue;
      }
    }

    return { installed: false };
  } catch (error) {
    console.error("Error checking repository installation:", error);
    return { installed: false };
  }
}

/**
 * Create a repository dispatch event (for triggering GitHub Actions)
 */
export async function createRepositoryDispatch(
  installationId: number,
  repositoryFullName: string,
  eventType: string,
  clientPayload?: Record<string, unknown>,
): Promise<void> {
  if (!githubApp) {
    throw new Error("GitHub App is not configured");
  }

  try {
    const installationOctokit =
      await githubApp.getInstallationOctokit(installationId);
    const [owner, repo] = repositoryFullName.split("/");

    await installationOctokit.request("POST /repos/{owner}/{repo}/dispatches", {
      owner,
      repo,
      event_type: eventType,
      client_payload: clientPayload,
    });
  } catch (error) {
    console.error("Error creating repository dispatch:", error);
    throw error;
  }
}
