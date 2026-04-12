import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

export async function POST(request: NextRequest) {
  const { owner, repo, branches } = await request.json();
  if (!mockGitHubState.getRepository(owner, repo)) {
    mockGitHubState.createRepository(owner, repo);
  }
  for (const name of branches) {
    mockGitHubState.createBranch(owner, repo, name, false);
  }
  const all = mockGitHubState.getBranches(owner, repo);
  return NextResponse.json({ count: all.length, branches: all.map(b => b.name) });
}
