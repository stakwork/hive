import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { QUICK_ASK_SYSTEM_PROMPT } from "@/lib/constants/prompt";
import { getQuickAskTools } from "@/lib/ai/quickAskTools";
import { streamText, hasToolCall, ModelMessage } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const question = searchParams.get("question");
    const workspaceSlug = searchParams.get("workspace");

    if (!question) {
      return NextResponse.json({ error: "Missing required parameter: question" }, { status: 400 });
    }
    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspaceAccess.workspace?.id },
    });
    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found for this workspace" }, { status: 404 });
    }
    if (!swarm.swarmUrl) {
      return NextResponse.json({ error: "Swarm URL not configured" }, { status: 404 });
    }

    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");


    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    // Helper to fetch learnings from stakgraph MCP
    async function fetchLearnings(q: string) {
      const res = await fetch(`${baseSwarmUrl}/learnings?limit=3&question=${encodeURIComponent(q)}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": decryptedSwarmApiKey,
        },
      });
      return res.ok ? await res.json() : [];
    }

    const provider: Provider = "google";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug);
    const tools = getQuickAskTools(fetchLearnings);

    const messages: ModelMessage[] = [
      { role: "system", content: QUICK_ASK_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    const result = streamText({
      model,
      tools,
      messages,
      stopWhen: hasToolCall("final_answer"),
    });
    return result.toTextStreamResponse();
  } catch (error) {
    console.error("Quick Ask API error:", error);
    return NextResponse.json({ error: "Failed to process quick ask" }, { status: 500 });
  }
}
