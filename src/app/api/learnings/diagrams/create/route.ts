import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmConfig } from "../../utils";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { repoAgent } from "@/lib/ai/askTools";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";

const MERMAID_INSTRUCTION =
  "\n\nReturn a mermaid diagram surrounded by backticks like ```mermaid ... ```. Only return the mermaid block, no other commentary.";

export function extractMermaidBody(text: string): string | null {
  const match = /```mermaid\s*([\s\S]*?)```/.exec(text);
  return match ? match[1].trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspace, name, prompt } = body;

    if (!workspace || !name || !prompt) {
      return NextResponse.json({ error: "Missing required fields: workspace, name, prompt" }, { status: 400 });
    }

    const userIsSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);
    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id, { isSuperAdmin: userIsSuperAdmin });
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    // Get workspace access to retrieve workspace ID
    const workspaceAccess = await validateWorkspaceAccess(workspace, userOrResponse.id, true);
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    const primaryRepo = await getPrimaryRepository(workspaceAccess.workspace.id);
    if (!primaryRepo) {
      return NextResponse.json({ error: "No repository configured for this workspace" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspace);
    const token = githubProfile?.token;
    if (!token) {
      return NextResponse.json({ error: "GitHub PAT not found for this user" }, { status: 404 });
    }

    const augmentedPrompt = prompt + MERMAID_INSTRUCTION;

    const agentResult = await repoAgent(baseSwarmUrl, decryptedSwarmApiKey, {
      repo_url: primaryRepo.repositoryUrl,
      prompt: augmentedPrompt,
      pat: token,
      skills: { mermaid: true },
    });

    const responseContent = agentResult?.content ?? JSON.stringify(agentResult);
    const extractedBody = extractMermaidBody(responseContent);

    if (!extractedBody) {
      return NextResponse.json({ error: "No mermaid diagram found in response" }, { status: 422 });
    }

    const diagram = await db.diagram.create({
      data: {
        name,
        body: extractedBody,
        description: null,
        createdBy: userOrResponse.id,
      },
    });

    await db.diagramWorkspace.create({
      data: {
        diagramId: diagram.id,
        workspaceId: workspaceAccess.workspace.id,
      },
    });

    return NextResponse.json({
      success: true,
      diagram: {
        id: diagram.id,
        name: diagram.name,
        body: diagram.body,
        description: diagram.description,
      },
    });
  } catch (error) {
    console.error("Create diagram API error:", error);
    return NextResponse.json({ error: "Failed to create diagram" }, { status: 500 });
  }
}
