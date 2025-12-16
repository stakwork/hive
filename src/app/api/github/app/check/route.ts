import { serviceConfigs } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Checks whether the current user has push access to a GitHub repository
 * through a GitHub App installation.
 */
export async function GET(request: Request) {
  try {
    // 1️⃣ Auth check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { hasPushAccess: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2️⃣ Validate input
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get("repositoryUrl");

    if (!repoUrl) {
      return NextResponse.json(
        { hasPushAccess: false, error: "Missing required parameter: repositoryUrl" },
        { status: 400 }
      );
    }

    // 3️⃣ Parse GitHub URL
    const githubMatch = repoUrl.match(
      /github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/
    );

    if (!githubMatch) {
      return NextResponse.json(
        { hasPushAccess: false, error: "Invalid GitHub repository URL" },
        { status: 400 }
      );
    }

    const [, owner, repo] = githubMatch;

    // 4️⃣ Fetch GitHub App installation token
    const tokens = await getUserAppTokens(session.user.id, owner);

    if (!tokens?.accessToken) {
      return NextResponse.json(
        {
          hasPushAccess: false,
          error: "No GitHub App tokens found for this repository owner",
        },
        { status: 403 }
      );
    }

    // 5️⃣ Verify installation exists in DB
    const sourceControlOrg = await db.sourceControlOrg.findUnique({
      where: { githubLogin: owner },
      select: { githubInstallationId: true },
    });

    if (!sourceControlOrg?.githubInstallationId) {
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

    const response = await fetch(repoApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    // 7️⃣ Handle access errors
    if (response.status === 404) {
      // Repo not accessible by this installation
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

    const hasPushAccess = !!(
      repoData.permissions?.push ||
      repoData.permissions?.maintain ||
      repoData.permissions?.admin
    );

    // 9️⃣ Success
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
