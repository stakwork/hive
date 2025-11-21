import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { GitLeakResult } from "@/types/git-leaks";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      include: {
        swarm: {
          select: {
            swarmUrl: true,
            swarmApiKey: true,
            status: true,
          },
        },
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        members: {
          where: {
            userId: userOrResponse.id,
            leftAt: null,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (workspace.ownerId !== userOrResponse.id && workspace.members.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!workspace?.swarm) {
      return NextResponse.json({ error: "Workspace does not have a swarm configured" }, { status: 400 });
    }

    if (!workspace.repositories || workspace.repositories.length === 0) {
      return NextResponse.json({ error: "No repositories configured for this workspace" }, { status: 400 });
    }

    if (!workspace.swarm.swarmApiKey) {
      return NextResponse.json({ error: "Swarm API key not configured" }, { status: 400 });
    }

    const graphServiceUrl = transformSwarmUrlToRepo2Graph(workspace.swarm.swarmUrl);
    if (!graphServiceUrl) {
      return NextResponse.json({ error: "Unable to determine graph service URL" }, { status: 500 });
    }

    const repoUrl = workspace.repositories[0].repositoryUrl;

    // Get GitHub username and PAT for authentication
    const githubAuth = await getGithubUsernameAndPAT(userOrResponse.id, slug);
    if (!githubAuth) {
      return NextResponse.json({ error: "GitHub authentication not configured for this workspace" }, { status: 400 });
    }

    const response = await swarmApiRequestAuth({
      swarmUrl: graphServiceUrl,
      endpoint: "/leaks",
      method: "GET",
      apiKey: workspace.swarm.swarmApiKey,
      params: {
        repo_url: repoUrl,
        username: githubAuth.username,
        pat: githubAuth.token,
      },
    });

    if (!response.ok) {
      console.error(`Git leaks scan failed with status ${response.status}`);
      console.error(`Git leaks response data:`, response.data);
      return NextResponse.json(
        {
          error: "Failed to scan for git leaks",
          details: `Service returned status ${response.status}`,
          responseData: response.data,
        },
        { status: response.status },
      );
    }

    const leaks = (response.data as { detect: GitLeakResult[] })?.detect || [];

    return NextResponse.json({
      success: true,
      leaks,
      count: leaks.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error running git leaks scan:", error);

    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.message.includes("timeout")) {
        return NextResponse.json({ error: "Git leaks scan timed out. Please try again." }, { status: 504 });
      }

      if (error.message.includes("fetch failed")) {
        return NextResponse.json({ error: "Unable to connect to graph service" }, { status: 503 });
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
