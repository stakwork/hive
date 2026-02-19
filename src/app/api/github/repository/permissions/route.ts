import { authOptions } from "@/lib/auth/nextauth";
import { serviceConfigs } from "@/config/services";
import { getUserAppTokens } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function checkRepositoryPermissions(accessToken: string, repoUrl: string): Promise<{
  hasAccess: boolean;
  canPush: boolean;
  canAdmin: boolean;
  permissions?: Record<string, boolean>;
  repositoryData?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  };
  error?: string;
}> {
  try {
    // Extract owner/repo from URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'invalid_repository_url'
      };
    }

    const [, owner, repo] = githubMatch;

    // Check repository access and permissions
    const response = await fetch(`${serviceConfigs.github.baseURL}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Parse permissions
      const permissions = repositoryData.permissions || {};
      const canPush = permissions.push === true || permissions.admin === true || permissions.maintain === true;
      const canAdmin = permissions.admin === true;

      return {
        hasAccess: true,
        canPush,
        canAdmin,
        permissions,
        repositoryData: {
          name: repositoryData.name,
          full_name: repositoryData.full_name,
          private: repositoryData.private,
          default_branch: repositoryData.default_branch,
        }
      };
    } else if (response.status === 404) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'repository_not_found_or_no_access'
      };
    } else if (response.status === 403) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'access_forbidden'
      };
    } else {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: `http_error_${response.status}`
      };
    }
  } catch (error) {
    console.error('Error checking repository permissions:', error);
    return {
      hasAccess: false,
      canPush: false,
      canAdmin: false,
      error: 'network_error'
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { repositoryUrl, workspaceSlug } = await request.json();

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: "Unauthorized"
      }, { status: 401 });
    }

    if (!repositoryUrl) {
      return NextResponse.json({
        success: false,
        error: "Repository URL is required"
      }, { status: 400 });
    }

    // Extract GitHub owner from repository URL
    const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)/);
    if (!githubMatch) {
      return NextResponse.json({
        success: false,
        error: "Invalid repository URL"
      }, { status: 400 });
    }

    const githubOwner = githubMatch[1];

    // Check if repository owner matches workspace's linked GitHub organization
    if (workspaceSlug) {
      const { db } = await import("@/lib/db");
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: { sourceControlOrg: true },
      });
      const linkedLogin = workspace?.sourceControlOrg?.githubLogin;
      if (linkedLogin && linkedLogin.toLowerCase() !== githubOwner.toLowerCase()) {
        return NextResponse.json(
          {
            success: false,
            error: "org_mismatch",
            message: `Repository must belong to the '${linkedLogin}' organization.`,
          },
          { status: 422 }
        );
      }
    }

    // Get user's GitHub App tokens for this repository's organization
    const tokens = await getUserAppTokens(session.user.id, githubOwner);

    if (!tokens?.accessToken) {
      return NextResponse.json({
        success: false,
        error: "no_github_tokens",
        message: "No GitHub App tokens found for this repository's organization"
      }, { status: 403 });
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
        repository: permissionCheck.repositoryData
      },
      error: permissionCheck.error
    });

  } catch (error) {
    console.error('Error checking repository permissions:', error);
    return NextResponse.json({
      success: false,
      error: "internal_server_error"
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repositoryUrl = searchParams.get('repositoryUrl');
  const workspaceSlug = searchParams.get('workspaceSlug');

  if (!repositoryUrl) {
    return NextResponse.json({
      success: false,
      error: "Repository URL is required"
    }, { status: 400 });
  }

  // Forward to POST handler
  const postRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ repositoryUrl, workspaceSlug })
  });

  return POST(postRequest);
}
