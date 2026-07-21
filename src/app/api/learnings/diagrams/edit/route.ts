import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmConfig } from "../../utils";
import { getAllRepositories, joinRepoUrls } from "@/lib/helpers/repository";
import { repoAgent } from "@/lib/ai/askTools";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { extractMermaidBody } from "@/lib/diagrams/mermaid-parser";
import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";
// Deep import — see comment in services/task-workflow.ts.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";

const MERMAID_INSTRUCTION =
  "\n\nReturn a mermaid diagram surrounded by backticks like ```mermaid ... ```. Only return the mermaid block, no other commentary.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace, diagramId, prompt } = body;

    if (!workspace || !diagramId || !prompt) {
      return NextResponse.json({ error: "Missing required fields: workspace, diagramId, prompt" }, { status: 400 });
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspace });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const existingDiagram = await db.diagram.findUnique({ where: { id: diagramId } });
    if (!existingDiagram) {
      return NextResponse.json({ error: "Diagram not found" }, { status: 404 });
    }

    const allRepos = await getAllRepositories(ok.workspaceId);
    if (allRepos.length === 0) {
      return NextResponse.json({ error: "No repositories configured for this workspace" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(ok.userId, workspace);
    const token = githubProfile?.token;
    if (!token) {
      return NextResponse.json({ error: "GitHub PAT not found for this user" }, { status: 404 });
    }

    const resolved = await resolveExtraSwarms(prompt, ok.userId);
    const subAgents = resolved.length
      ? resolved.map((s) => ({
          name: s.name,
          description: s.description,
          url: s.url,
          apiToken: s.apiKey,
          repoUrl: s.repoUrls,
          toolsConfig: s.toolsConfig as Record<string, unknown> | undefined,
        }))
      : undefined;

    const augmentedPrompt =
      `<current-diagram>\n${existingDiagram.body}\n</current-diagram>\n<user-prompt>\n${prompt}\n</user-prompt>` +
      MERMAID_INSTRUCTION;

    // Route through this workspace's Bifrost (when enabled) so the
    // call lands on `logs.db` with `agent-name=diagram-agent`.
    // Matches the create-diagram route's agent name so cost
    // rollups aggregate across both flows.
    const bifrost = await getBifrostForLLM(
      {
        workspaceId: ok.workspaceId,
        workspaceSlug: workspace,
        userId: ok.userId,
      },
      { agentName: "diagram-agent" },
    );

    const agentResult = await repoAgent(
      baseSwarmUrl,
      decryptedSwarmApiKey,
      {
        repo_url: joinRepoUrls(allRepos)!,
        prompt: augmentedPrompt,
        pat: token,
        skills: { mermaid: true },
        toolsConfig: { learn_concepts: true },
        model: "opus",
        subAgents,
      },
      bifrost,
    );

    if (typeof agentResult === "string") {
      return NextResponse.json({ error: "Diagram generation was cancelled" }, { status: 422 });
    }
    const responseContent = (agentResult as Record<string, string>)?.content ?? JSON.stringify(agentResult);
    const extractedBody = extractMermaidBody(responseContent);

    if (!extractedBody) {
      return NextResponse.json({ error: "No mermaid diagram found in response" }, { status: 422 });
    }

    const newDiagram = await db.diagram.create({
      data: {
        name: existingDiagram.name,
        body: extractedBody,
        description: null,
        createdBy: ok.userId,
        groupId: existingDiagram.groupId,
      },
    });

    await db.diagramWorkspace.create({
      data: {
        diagramId: newDiagram.id,
        workspaceId: ok.workspaceId,
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
