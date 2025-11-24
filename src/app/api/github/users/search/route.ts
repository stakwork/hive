import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import axios from "axios";

export const runtime = "nodejs";

interface GitHubSearchUser {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
  score: number;
}

interface GitHubFullUser {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

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
    const searchResponse = await axios.get("https://api.github.com/search/users", {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        q: query,
        per_page: 10, // Limit to 10 results
      },
    });

    const searchUsers: GitHubSearchUser[] = searchResponse.data.items;

    // Check rate limit from search response
    const rateLimitRemaining = parseInt(searchResponse.headers["x-ratelimit-remaining"] || "5000", 10);
    const shouldFetchProfiles = rateLimitRemaining > searchUsers.length + 5;

    console.log(
      `[GitHub User Search] Rate limit remaining: ${rateLimitRemaining}, will fetch profiles: ${shouldFetchProfiles}`,
    );

    // If rate limit is low, return search results without fetching full profiles
    if (!shouldFetchProfiles) {
      console.warn(
        `[GitHub User Search] Rate limit too low (${rateLimitRemaining}), returning search results only`,
      );
      const users = searchUsers.map((user) => ({
        id: user.id,
        login: user.login,
        avatar_url: user.avatar_url,
        html_url: user.html_url,
        type: user.type,
        score: user.score,
        name: null,
        bio: null,
        public_repos: 0,
        followers: 0,
      }));

      return NextResponse.json({
        users,
        total_count: searchResponse.data.total_count,
      });
    }

    // Fetch full profiles for each user
    const enrichedUsers: GitHubFullUser[] = [];
    let rateLimitHit = false;

    for (const searchUser of searchUsers) {
      // Stop if we've hit rate limit in previous iteration
      if (rateLimitHit) {
        console.warn(
          `[GitHub User Search] Rate limit hit, returning partial results. Enriched: ${enrichedUsers.length}, Remaining: ${searchUsers.length - enrichedUsers.length}`,
        );
        // Add remaining users with search data only
        enrichedUsers.push({
          id: searchUser.id,
          login: searchUser.login,
          avatar_url: searchUser.avatar_url,
          html_url: searchUser.html_url,
          type: searchUser.type,
          name: null,
          bio: null,
          public_repos: 0,
          followers: 0,
        });
        continue;
      }

      try {
        const profileResponse = await axios.get(`https://api.github.com/users/${searchUser.login}`, {
          headers: {
            Authorization: `token ${pat}`,
            Accept: "application/vnd.github.v3+json",
          },
        });

        const profile = profileResponse.data;

        enrichedUsers.push({
          id: profile.id,
          login: profile.login,
          avatar_url: profile.avatar_url,
          html_url: profile.html_url,
          type: profile.type,
          name: profile.name || null,
          bio: profile.bio || null,
          public_repos: profile.public_repos || 0,
          followers: profile.followers || 0,
        });

        // Check rate limit after each request
        const currentRateLimit = parseInt(profileResponse.headers["x-ratelimit-remaining"] || "0", 10);
        if (currentRateLimit < 10) {
          console.warn(`[GitHub User Search] Rate limit low (${currentRateLimit}), stopping profile fetches`);
          rateLimitHit = true;
        }
      } catch (error: unknown) {
        console.error(`[GitHub User Search] Failed to fetch profile for ${searchUser.login}:`, error);

        // Check if it's a rate limit error
        if (
          error &&
          typeof error === "object" &&
          "response" in error &&
          error.response &&
          typeof error.response === "object" &&
          "status" in error.response &&
          (error.response.status === 429 || error.response.status === 403)
        ) {
          console.warn(`[GitHub User Search] Rate limit hit (${error.response.status}), stopping profile fetches`);
          rateLimitHit = true;
        }

        // Fallback to search data
        enrichedUsers.push({
          id: searchUser.id,
          login: searchUser.login,
          avatar_url: searchUser.avatar_url,
          html_url: searchUser.html_url,
          type: searchUser.type,
          name: null,
          bio: null,
          public_repos: 0,
          followers: 0,
        });
      }
    }

    return NextResponse.json({
      users: enrichedUsers,
      total_count: searchResponse.data.total_count,
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

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      (error.response.status === 429 || error.response.status === 403)
    ) {
      return NextResponse.json({ error: "GitHub API rate limit exceeded" }, { status: 429 });
    }

    return NextResponse.json({ error: "Failed to search GitHub users" }, { status: 500 });
  }
}