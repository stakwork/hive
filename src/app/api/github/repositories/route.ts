import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import axios from "axios";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user's GitHub account
    const account = await db.account.findFirst({
      where: {
        userId: (session.user as { id: string }).id,
        provider: "github",
      },
    });

    if (!account?.access_token) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 },
      );
    }

    // Fetch repositories from GitHub API
    const response = await axios.get("https://api.github.com/user/repos", {
      headers: {
        Authorization: `token ${encryptionService.decryptField("access_token", account.access_token)}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        sort: "updated",
        per_page: 100, // Get up to 100 repositories
        type: "all", // Include both owned and contributed repos
      },
    });

    const repositories = response.data.map((repo: Record<string, unknown>) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      fork: repo.fork,
      stargazers_count: repo.stargazers_count,
      watchers_count: repo.watchers_count,
      language: repo.language,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      size: repo.size,
      open_issues_count: repo.open_issues_count,
      topics: repo.topics || [],
    }));

    return NextResponse.json({
      repositories,
      total_count: repositories.length,
    });
  } catch (error: unknown) {
    console.error("Error fetching repositories:", error);

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      error.response.status === 401
    ) {
      return NextResponse.json(
        { error: "GitHub token expired or invalid" },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}
