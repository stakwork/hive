import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRepositoryAccess } from "@/lib/githubApp";

/**
 * Bulk repository access check endpoint
 * 
 * Checks if specific users have access to specific repositories.
 * Used when adding members to workspace or adding repos to workspace.
 */

interface BulkAccessCheckRequest {
  checks: Array<{
    githubUsername: string;
    repositoryUrl: string;
  }>;
}

interface AccessCheckResult {
  githubUsername: string;
  repositoryUrl: string;
  hasAccess: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: "Unauthorized"
      }, { status: 401 });
    }

    const body = await request.json() as BulkAccessCheckRequest;
    const { checks } = body;

    if (!checks || !Array.isArray(checks) || checks.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Invalid request: checks array required"
      }, { status: 400 });
    }

    // Import DB to get GitHub usernames for user IDs
    const { db } = await import("@/lib/db");

    // Process all checks in parallel
    const results: AccessCheckResult[] = await Promise.all(
      checks.map(async (check) => {
        try {
          // Find the user by GitHub username
          const githubAuth = await db.gitHubAuth.findUnique({
            where: { login: check.githubUsername },
            select: { userId: true },
          });

          if (!githubAuth) {
            return {
              githubUsername: check.githubUsername,
              repositoryUrl: check.repositoryUrl,
              hasAccess: false,
              error: "User not found in system",
            };
          }

          // Check if this user has access to the repository
          const accessCheck = await checkRepositoryAccess(
            githubAuth.userId,
            check.repositoryUrl
          );

          return {
            githubUsername: check.githubUsername,
            repositoryUrl: check.repositoryUrl,
            hasAccess: accessCheck.hasAccess,
            error: accessCheck.error,
          };
        } catch (error) {
          console.error(
            `Error checking access for ${check.githubUsername} to ${check.repositoryUrl}:`,
            error
          );
          return {
            githubUsername: check.githubUsername,
            repositoryUrl: check.repositoryUrl,
            hasAccess: false,
            error: "Failed to check access",
          };
        }
      })
    );

    // Separate successful checks from failed ones
    const accessibleRepos = results.filter((r) => r.hasAccess);
    const inaccessibleRepos = results.filter((r) => !r.hasAccess);

    return NextResponse.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          accessible: accessibleRepos.length,
          inaccessible: inaccessibleRepos.length,
        },
      },
    });
  } catch (error) {
    console.error("Error in bulk access check:", error);
    return NextResponse.json({
      success: false,
      error: "Internal server error"
    }, { status: 500 });
  }
}
