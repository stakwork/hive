import { getUserAppTokens } from "@/lib/githubApp";
import { checkRepositoryPermissions } from "@/lib/github/checkRepositoryPermissions";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { repositoryUrl, ...rest } = await request.json();

    if (!repositoryUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "Repository URL is required",
        },
        { status: 400 },
      );
    }

    // Extract GitHub owner from repository URL
    const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)/);
    if (!githubMatch) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid repository URL",
        },
        { status: 400 },
      );
    }

    const githubOwner = githubMatch[1];

    // Get user's GitHub App tokens for this repository's organization
    const tokens = await getUserAppTokens(userOrResponse.id, githubOwner);

    if (!tokens?.accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "no_github_tokens",
          message: "No GitHub App tokens found for this repository's organization",
        },
        { status: 403 },
      );
    }

    // Check repository permissions
    const permissionCheck = await checkRepositoryPermissions(tokens.accessToken, repositoryUrl);

    return NextResponse.json({
      success: permissionCheck.hasAccess,
      data: {
        hasAccess: permissionCheck.hasAccess,
        canPush: permissionCheck.canPush,
        canAdmin: permissionCheck.canAdmin,
        permissions: permissionCheck.permissions,
        repository: permissionCheck.repositoryData,
      },
      error: permissionCheck.error,
    });
  } catch (error) {
    console.error("Error checking repository permissions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "internal_server_error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repositoryUrl = searchParams.get("repositoryUrl");
  const workspaceSlug = searchParams.get("workspaceSlug");

  if (!repositoryUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "Repository URL is required",
      },
      { status: 400 },
    );
  }

  // Forward to POST handler
  const postRequest = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ repositoryUrl, workspaceSlug }),
  });

  return POST(postRequest);
}
