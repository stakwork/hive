import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmConfig } from "../../utils";
import { getAllRepositories, joinRepoUrls } from "@/lib/helpers/repository";
import { repoAgent } from "@/lib/ai/askTools";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import { extractMermaidBody } from "@/lib/diagrams/mermaid-parser";

const MERMAID_INSTRUCTION =
  "\n\nReturn a mermaid diagram surrounded by backticks like ```mermaid ... ```. Only return the mermaid block, no other commentary.";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspace, diagramId, prompt } = body;

    if (!workspace || !diagramId || !prompt) {
      return NextResponse.json({ error: "Missing required fields: workspace, diagramId, prompt" }, { status: 400 });
    }

    const userIsSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);
    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id, { isSuperAdmin: userIsSuperAdmin });
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const workspaceAccess = await validateWorkspaceAccess(workspace, userOrResponse.id, true);
    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    const existingDiagram = await db.diagram.findUnique({ where: { id: diagramId } });
    if (!existingDiagram) {
      return NextResponse.json({ error: "Diagram not found" }, { status: 404 });
    }

    const allRepos = await getAllRepositories(workspaceAccess.workspace.id);
    if (allRepos.length === 0) {
      return NextResponse.json({ error: "No repositories configured for this workspace" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspace);
    const token = githubProfile?.token;
    if (!token) {
      return NextResponse.json({ error: "GitHub PAT not found for this user" }, { status: 404 });
    }

    const augmentedPrompt =
      `<current-diagram>\n${existingDiagram.body}\n</current-diagram>\n<user-prompt>\n${prompt}\n</user-prompt>` +
      MERMAID_INSTRUCTION;

    const agentResult = await repoAgent(baseSwarmUrl, decryptedSwarmApiKey, {
      repo_url: joinRepoUrls(allRepos),
      prompt: augmentedPrompt,
      pat: token,
      skills: { mermaid: true },
    });

    const responseContent = agentResult?.content ?? JSON.stringify(agentResult);
    const extractedBody = extractMermaidBody(responseContent);

    if (!extractedBody) {
      return NextResponse.json({ error: "No mermaid diagram found in response" }, { status: 422 });
    }

    const newDiagram = await db.diagram.create({
      data: {
        name: existingDiagram.name,
        body: extractedBody,
        description: null,
        createdBy: userOrResponse.id,
        groupId: existingDiagram.groupId,
      },
    });

    await db.diagramWorkspace.create({
      data: {
        diagramId: newDiagram.id,
        workspaceId: workspaceAccess.workspace.id,
      },
    });

    return NextResponse.json({
      success: true,
      diagram: {
        id: newDiagram.id,
        name: newDiagram.name,
        body: newDiagram.body,
        description: newDiagram.description,
        groupId: newDiagram.groupId,
      },
    });
  } catch (error) {
    console.error("Edit diagram API error:", error);
    return NextResponse.json({ error: "Failed to edit diagram" }, { status: 500 });
  }
}
