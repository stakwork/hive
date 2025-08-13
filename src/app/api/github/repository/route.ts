import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import axios from "axios";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get("repoUrl");

  if (!repoUrl) {
    return NextResponse.json({ error: "Repo URL is required" }, { status: 400 });
  }

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

    function parseOwnerRepo(url: string): { owner: string; repo: string } {
      const u = url.replace(/\.git$/i, "");
      // SSH form
      const ssh = u.match(/^git@[^:]+:([^/]+)\/([^/]+)$/);
      if (ssh) return { owner: ssh[1], repo: ssh[2] };
      // HTTPS form
      const https = u.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/i);
      if (https) return { owner: https[1], repo: https[2] };
      throw new Error(`Cannot parse owner/repo from: ${url}`);
    }

    const { owner, repo } = parseOwnerRepo(repoUrl);

    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${encryptionService.decryptField("access_token", account.access_token)}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const repoData = res.data;

    if (repoData.permissions.push) {
      const data = {
        id: repoData.id,
        name: repoData.name,
        full_name: repoData.full_name,
        description: repoData.description,
        private: repoData.private,
        fork: repoData.fork,
        stargazers_count: repoData.stargazers_count,
        watchers_count: repoData.watchers_count,
        default_branch: repoData.default_branch,
        updated_at: repoData.updated_at,
        html_url: repoData.html_url,
        clone_url: repoData.clone_url,
        size: repoData.size,
        open_issues_count: repoData.open_issues_count,
        topics: repoData.topics || [],
      };

      return NextResponse.json({
        message: 'Repo is pushable',
        data,
      })
    } else {
      return NextResponse.json(
        { error: "You do not have push access to this repository" },
        { status: 403 })
    }

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
