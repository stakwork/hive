import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getSwarmConfig } from "./utils";
import { getRepository } from "@/lib/helpers/repository";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const question = searchParams.get("question");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspaceSlug, userOrResponse.id);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    let swarmUrl = `${baseSwarmUrl}/learnings`;
    if (question) {
      swarmUrl += `?question=${encodeURIComponent(question)}`;
    }

    const response = await fetch(swarmUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Learnings API proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch learnings data" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const repositoryId = searchParams.get("repositoryId");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspaceSlug, userOrResponse.id);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    // Get workspace access to retrieve workspace ID
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id);
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    // Get repository (by ID if provided, otherwise primary)
    const targetRepo = await getRepository(workspaceAccess.workspace.id, repositoryId);
    
    if (!targetRepo && repositoryId) {
      return NextResponse.json({ error: "Repository not found or does not belong to workspace" }, { status: 404 });
    }
    
    if (!targetRepo) {
      return NextResponse.json({ error: "No repository configured for this workspace" }, { status: 404 });
    }

    // Parse repository URL to extract owner and repo
    let owner: string, repo: string;
    try {
      const parsed = parseOwnerRepo(targetRepo.repositoryUrl);
      owner = parsed.owner;
      repo = parsed.repo;
    } catch (error) {
      console.error("Failed to parse repository URL:", error);
      return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
    }

    // Get GitHub PAT for the user
    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspaceSlug);
    const token = githubProfile?.token;

    if (!token) {
      return NextResponse.json({ error: "GitHub PAT not found for this user" }, { status: 404 });
    }

    // Call gitree/process endpoint with token parameter
    const swarmUrl = `${baseSwarmUrl}/gitree/process?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&token=${encodeURIComponent(token)}&summarize=true&link=true`;

    fetch(swarmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`Swarm gitree/process error: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error("Gitree process request failed:", error);
      });

    return NextResponse.json({ success: true, message: "Repository processing initiated" });
  } catch (error) {
    console.error("Gitree process API proxy error:", error);
    return NextResponse.json({ error: "Failed to process repository" }, { status: 500 });
  }
}
