import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmConfig } from "../../utils";
import { getAllRepositories, joinRepoUrls } from "@/lib/helpers/repository";
import { repoAgent } from "@/lib/ai/askTools";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { extractMermaidBody } from "@/lib/diagrams/mermaid-parser";
import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";

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
          url: s.url,
          apiToken: s.apiKey,
          repoUrl: s.repoUrls,
          toolsConfig: s.toolsConfig as Record<string, unknown> | undefined,
        }))
      : undefined;

    const augmentedPrompt =
      `<current-diagram>\n${existingDiagram.body}\n</current-diagram>\n<user-prompt>\n${prompt}\n</user-prompt>` +
      MERMAID_INSTRUCTION;

    const agentResult = await repoAgent(baseSwarmUrl, decryptedSwarmApiKey, {
      repo_url: joinRepoUrls(allRepos)!,
      prompt: augmentedPrompt,
      pat: token,
      skills: { mermaid: true },
      toolsConfig: { learn_concepts: true },
      model: "opus",
      subAgents,
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
