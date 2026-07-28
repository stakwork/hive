import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import type { ParsedMessage, ToolCallContent } from "@/lib/utils/agent-log-stats";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

export const CANVAS_AGENT_NAME = "canvas-agent";
const CANVAS_AGENT_SOURCE = "canvas_chat";
const CANVAS_AGENT_PROVIDER = "anthropic";

export function transcriptFromStoredMessages(
  messages: StoredMessage[],
): ParsedMessage[] {
  return messages.map((m) => {
    const base: ParsedMessage = {
      role: m.role,
      timestamp: m.timestamp ?? null,
    };
    if (m.usage) base.usage = m.usage;

    if (m.toolCalls && m.toolCalls.length > 0) {
      base.content = m.toolCalls.map(
        (tc): ToolCallContent => ({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.toolName,
          input: tc.input,
        }),
      );
      return base;
    }

    base.content = m.content;
    return base;
  });
}

export async function writeCanvasAgentLog(args: {
  workspaceId: string;
  conversationId: string;
  model?: string;
  startedAt: Date;
  completedAt: Date;
}): Promise<void> {
  const { workspaceId, conversationId, model, startedAt, completedAt } = args;

  try {
    const row = await db.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { messages: true },
    });
    const messages = Array.isArray(row?.messages)
      ? (row.messages as unknown as StoredMessage[])
      : [];
    if (messages.length === 0) return;

    const config = {
      ...(model ? { model } : {}),
      provider: CANVAS_AGENT_PROVIDER,
      source: CANVAS_AGENT_SOURCE,
    };
    const logContent = JSON.stringify({
      sessionId: conversationId,
      messages: transcriptFromStoredMessages(messages),
      config,
    });

    const { stats } = parseAgentLogStats(logContent);

    const blob = await put(
      `agent-logs/${workspaceId}/${conversationId}/${CANVAS_AGENT_NAME}.json`,
      logContent,
      {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );

    const existing = await db.agentLog.findFirst({
      where: {
        agent: CANVAS_AGENT_NAME,
        workspaceId,
        sessionId: conversationId,
      },
      select: { id: true },
    });

    const data = {
      blobUrl: blob.url,
      config: config as Prisma.InputJsonValue,
      stats: stats as unknown as Prisma.InputJsonValue,
      provider: CANVAS_AGENT_PROVIDER,
      source: CANVAS_AGENT_SOURCE,
      completedAt,
    };

    if (existing) {
      await db.agentLog.update({ where: { id: existing.id }, data });
    } else {
      await db.agentLog.create({
        data: {
          ...data,
          agent: CANVAS_AGENT_NAME,
          workspaceId,
          sessionId: conversationId,
          startedAt,
        },
      });
    }
  } catch (error) {
    console.error("[canvas-agent-log] write failed", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
