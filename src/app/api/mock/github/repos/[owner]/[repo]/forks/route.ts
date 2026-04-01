import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Fork Repository Endpoint
 *
 * Simulates: POST https://api.github.com/repos/{owner}/{repo}/forks
 * Both new forks and repeat calls return 202 with the repository payload.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        message: "Requires authentication",
        documentation_url: "https://docs.github.com/rest/repos/forks",
      },
      { status: 401 }
    );
  }

  const { repo } = await params;

  // Derive the forking user login from the token (mirrors mock/github/user/route.ts)
  const token = authHeader.replace("Bearer ", "");
  const mockUserLogin = token.includes("mock") ? "mock-user" : "test-user";

  // createRepository is idempotent — returns existing fork if already present
  const forkedRepo = mockGitHubState.createRepository(mockUserLogin, repo);

  return NextResponse.json(forkedRepo, { status: 202 });
}
