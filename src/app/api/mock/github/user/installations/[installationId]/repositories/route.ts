import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List Installation Repositories Endpoint
 * 
 * Simulates: GET https://api.github.com/user/installations/{installation_id}/repositories
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ installationId: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/apps/installations",
        },
        { status: 401 }
      );
    }

    const { installationId: installationIdStr } = await params;
    const installationId = parseInt(installationIdStr, 10);
    const installation = mockGitHubState.getInstallation(installationId);

    if (!installation) {
      return NextResponse.json(
        {
          message: "Installation not found",
          documentation_url: "https://docs.github.com/rest/apps/installations",
        },
        { status: 404 }
      );
    }

    // Get or create repositories for this installation's owner
    const owner = installation.account.login;
    let repositories = mockGitHubState.getRepositoriesByOwner(owner);

    // If no repositories exist, auto-create a default one
    if (repositories.length === 0) {
      mockGitHubState.createRepository(owner, "test-repo", false, "main");
      repositories = mockGitHubState.getRepositoriesByOwner(owner);
    }

    return NextResponse.json({
      total_count: repositories.length,
      repositories,
    });
  } catch (error) {
    console.error("Mock GitHub installation repositories error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
