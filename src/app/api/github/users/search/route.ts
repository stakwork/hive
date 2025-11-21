import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGithubUsernameAndPAT } from "@/lib/auth";
import axios from "axios";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ error: "Search query must be at least 2 characters" }, { status: 400 });
    }

    const userId = (session.user as { id: string }).id;

    // Use user's OAuth token for user search (no workspace required)
    const githubProfile = await getGithubUsernameAndPAT(userId);
    if (!githubProfile?.token) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }
    const pat = githubProfile.token;

    // Search GitHub users
    const response = await axios.get("https://api.github.com/search/users", {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        q: query,
        per_page: 10, // Limit to 10 results
      },
    });

    const users = response.data.items.map((user: Record<string, unknown>) => ({
      id: user.id,
      login: user.login,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
      type: user.type,
      score: user.score,
    }));

    return NextResponse.json({
      users,
      total_count: response.data.total_count,
    });
  } catch (error: unknown) {
    console.error("Error searching GitHub users:", error);

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      error.response.status === 401
    ) {
      return NextResponse.json({ error: "GitHub token expired or invalid" }, { status: 401 });
    }

    return NextResponse.json({ error: "Failed to search GitHub users" }, { status: 500 });
  }
}
