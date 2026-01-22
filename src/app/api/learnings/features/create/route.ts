import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getSwarmConfig } from "../../utils";
import { getRepository } from "@/lib/helpers/repository";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspace, prompt, name, repositoryId } = body;

    if (!workspace || !prompt || !name) {
      return NextResponse.json({ error: "Missing required fields: workspace, prompt, name" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    // Get workspace access to retrieve workspace ID
    const workspaceAccess = await validateWorkspaceAccess(workspace, userOrResponse.id);
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
    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspace);
    const token = githubProfile?.token;

    if (!token) {
      return NextResponse.json({ error: "GitHub PAT not found for this user" }, { status: 404 });
    }

    // Call gitree/create-feature endpoint
    const swarmUrl = `${baseSwarmUrl}/gitree/create-feature`;

    const response = await fetch(swarmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify({
        prompt,
        name,
        owner,
        repo,
        pat: token,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Swarm create-feature error: ${response.status} - ${errorText}`);
      return NextResponse.json({ error: "Failed to create feature" }, { status: response.status });
    }

    const initiateData = await response.json();
    const requestId = initiateData.request_id;

    if (!requestId) {
      return NextResponse.json({ error: "No request_id returned from swarm" }, { status: 500 });
    }

    // Poll for completion (backend polling)
    const maxAttempts = 120; // 10 minutes max (120 * 5 seconds)
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait before polling
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      // Poll progress endpoint
      const progressUrl = `${baseSwarmUrl}/progress?request_id=${encodeURIComponent(requestId)}`;
      const progressResponse = await fetch(progressUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": decryptedSwarmApiKey,
        },
      });

      if (!progressResponse.ok) {
        console.error(`Progress check failed: ${progressResponse.status}`);
        continue; // Retry on next iteration
      }

      const progressData = await progressResponse.json();

      if (progressData.status === "completed") {
        // Success! Return feature data
        return NextResponse.json({
          success: true,
          feature: progressData.result?.feature,
          usage: progressData.result?.usage,
        });
      } else if (progressData.status === "failed") {
        // Error occurred
        return NextResponse.json({ error: progressData.error || "Feature creation failed" }, { status: 500 });
      }
      // else: still pending, continue polling
    }

    // Timeout - max attempts reached
    return NextResponse.json({ error: "Feature creation timed out. Please try again." }, { status: 408 });
  } catch (error) {
    console.error("Create feature API proxy error:", error);
    return NextResponse.json({ error: "Failed to create feature" }, { status: 500 });
  }
}
