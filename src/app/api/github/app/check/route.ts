import { serviceConfigs } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getUserAppTokens, getPersonalOAuthToken } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Checks whether the current user has push access to a GitHub repository
 * through a GitHub App installation.
 */
export async function GET(request: Request) {
  try {
    console.log("[REPO CHECK] Starting repository access check");

    // 1️⃣ Auth check
    const session = await getServerSession(authOptions);
    console.log("[REPO CHECK] Session check:", { userId: session?.user?.id ? "present" : "missing" });

    if (!session?.user?.id) {
      console.log("[REPO CHECK] Unauthorized access attempt");
      return NextResponse.json(
        { hasPushAccess: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2️⃣ Validate input
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get("repositoryUrl");
    console.log("[REPO CHECK] Repository URL:", repoUrl);

    if (!repoUrl) {
      console.log("[REPO CHECK] Missing repositoryUrl parameter");
      return NextResponse.json(
        { hasPushAccess: false, error: "Missing required parameter: repositoryUrl" },
        { status: 400 }
      );
    }

    // 3️⃣ Parse GitHub URL
    const githubMatch = repoUrl.match(
      /github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?(?:[\/]?$)/
    );
    console.log("[REPO CHECK] URL parsing result:", { match: !!githubMatch });

    console.log("[REPO CHECK] Github Match:", githubMatch);

    if (!githubMatch) {
      console.log("[REPO CHECK] Invalid GitHub repository URL format");
      return NextResponse.json(
        { hasPushAccess: false, error: "Invalid GitHub repository URL" },
        { status: 400 }
      );
    }

    const [, owner, repo] = githubMatch;
    console.log("[REPO CHECK] Parsed repository:", { owner, repo });

    // 4️⃣ Check if SourceControlOrg exists (determines whether GitHub App is installed)
    // Use case-insensitive lookup since GitHub logins are case-insensitive
    console.log("[REPO CHECK] Checking source control org for owner:", owner);
    const sourceControlOrg = await db.source_control_orgs.findFirst({
      where: { githubLogin: { equals: owner, mode: "insensitive" } },
      select: { githubInstallationId: true },
    });
    console.log("[REPO CHECK] Source control org check:", {
      found: !!sourceControlOrg,
      installationId: sourceControlOrg?.githubInstallationId,
    });

    if (!sourceControlOrg) {
      // No org record at all — GitHub App has never been installed for this owner.
      // Attempt a personal OAuth token fallback so the caller gets a clean signal.
      console.log("[REPO CHECK] No SourceControlOrg found — GitHub App not installed. Attempting personal OAuth fallback.");
      await getPersonalOAuthToken(session.user.id); // fire-and-forget for logging; result not used
      return NextResponse.json(
        { hasPushAccess: false, error: "app_not_installed" },
        { status: 200 }
      );
    }

    // 5️⃣ Fetch GitHub App installation token
    console.log("[REPO CHECK] Fetching GitHub App tokens for user:", session.user.id, "owner:", owner);
    const tokens = await getUserAppTokens(session.user.id, owner);
    console.log("[REPO CHECK] Token fetch result:", { hasAccessToken: !!tokens?.accessToken });

    if (!tokens?.accessToken) {
      // Org exists but this user has no token — they haven't completed the OAuth flow yet.
      console.log("[REPO CHECK] SourceControlOrg found but no token for user — user not authorised");
      return NextResponse.json(
        { hasPushAccess: false, error: "user_not_authorised" },
        { status: 200 }
      );
    }

    if (!sourceControlOrg.githubInstallationId) {
      console.log("[REPO CHECK] No GitHub App installation ID found for repository owner");
      return NextResponse.json(
        {
          hasPushAccess: false,
          error: "No GitHub App installation found for this repository owner",
        },
        { status: 200 }
      );
    }

    // 6️⃣ 🔥 Correct check: fetch repo directly using installation token
    const repoApiUrl = `${serviceConfigs.github.baseURL}/repos/${owner}/${repo}`;
    console.log("[REPO CHECK] Making GitHub API request to:", repoApiUrl);

    const response = await fetch(repoApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    console.log("[REPO CHECK] GitHub API response status:", response.status);

    // 7️⃣ Handle access errors
    if (response.status === 404) {
      // Repo not accessible by this installation
      console.log("[REPO CHECK] Repository not accessible (404) - requires installation update");
      return NextResponse.json(
        {
          hasPushAccess: false,
          error: `Repository '${owner}/${repo}' is not accessible through the GitHub App installation.`,
          requiresInstallationUpdate: true,
          installationId: sourceControlOrg.githubInstallationId,
        },
        { status: 200 }
      );
    }

    if (!response.ok) {
      console.log("[REPO CHECK] GitHub API error:", {
        status: response.status,
        statusText: response.statusText
      });
      return NextResponse.json(
        {
          hasPushAccess: false,
          error: `GitHub API error ${response.status}`,
          requiresReauth: response.status === 401 || response.status === 403,
        },
        { status: 200 }
      );
    }

    // 8️⃣ Parse repo permissions
    const repoData = await response.json();
    console.log("[REPO CHECK] Repository permissions:", {
      push: !!repoData.permissions?.push,
      maintain: !!repoData.permissions?.maintain,
      admin: !!repoData.permissions?.admin
    });

    const hasPushAccess = !!(
      repoData.permissions?.push ||
      repoData.permissions?.maintain ||
      repoData.permissions?.admin
    );

    // 9️⃣ Success
    console.log("[REPO CHECK] Access check complete:", { hasPushAccess });
    return NextResponse.json(
      { hasPushAccess },
      { status: 200 }
    );

  } catch (error) {
    console.error("[REPO CHECK] Unexpected error:", error);
    return NextResponse.json(
      { hasPushAccess: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
