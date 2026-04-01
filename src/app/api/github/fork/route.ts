import { serviceConfigs } from "@/config/services";
import { authOptions } from "@/lib/auth/nextauth";
import { getPersonalOAuthToken } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/github/fork
 *
 * Forks a GitHub repository into the authenticated user's account.
 * If the fork already exists, GitHub still returns it — so both cases succeed.
 *
 * Body: { repositoryUrl: string }
 * Returns: { forkUrl: string }
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let repositoryUrl: string | undefined;
  try {
    const body = await request.json();
    repositoryUrl = body?.repositoryUrl;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!repositoryUrl) {
    return NextResponse.json({ error: "repositoryUrl is required" }, { status: 400 });
  }

  // Parse owner/repo from GitHub URL
  const githubMatch = repositoryUrl.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/
  );
  if (!githubMatch) {
    return NextResponse.json({ error: "Invalid GitHub repository URL" }, { status: 400 });
  }
  const [, owner, repo] = githubMatch;

  const token = await getPersonalOAuthToken(session.user.id);
  if (!token) {
    return NextResponse.json({ error: "No GitHub OAuth token found" }, { status: 401 });
  }

  const forkUrl = `${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/forks`;

  const githubResponse = await fetch(forkUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (githubResponse.status === 403) {
    return NextResponse.json({ error: "insufficient_scope" }, { status: 403 });
  }

  if (githubResponse.status === 202 || githubResponse.status === 200) {
    const data = await githubResponse.json();
    return NextResponse.json({ forkUrl: data.html_url });
  }

  return NextResponse.json({ error: "Failed to fork repository" }, { status: 500 });
}
