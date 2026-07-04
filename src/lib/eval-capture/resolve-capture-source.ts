/**
 * Shared transcript resolver for eval-capture routes.
 *
 * Tries AgentLog first (existing path); if not found, falls back to
 * SharedConversation mirroring the exact ownership check used in the
 * GET /api/workspaces/[slug]/chat/conversations/[conversationId] route.
 *
 * IDOR: ownership is verified here, before any blob fetch, Jarvis write,
 * or mock delegation.
 */
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import { chatMessagesToParsedMessages } from "@/lib/utils/chat-conversation-log";
import type { ParsedMessage } from "@/lib/utils/agent-log-stats";
import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CaptureSource =
  | {
      kind: "agent_log";
      workspaceId: string;
      blobUrl: string;
      agent: string | null;
      source: string | null;
      metadata: unknown;
      config: unknown;
      conversation: ParsedMessage[];
      effectiveConfig: Record<string, unknown> | undefined;
    }
  | {
      kind: "conversation";
      workspaceId: string;
      conversationId: string;
      source: string | null;
      conversation: ParsedMessage[];
    };

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * @param slug       - Workspace slug from the route params.
 * @param id         - The logId / conversationId from the route params.
 * @returns CaptureSource discriminated union, or null if the record is not
 *          found, or a 403-style object if found but not owned by the workspace.
 */
export async function resolveCaptureSource(
  slug: string,
  id: string,
): Promise<CaptureSource | { denied: true } | null> {
  // ── 1. Fetch workspace (needed for IDOR checks) ────────────────────────────
  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true, sourceControlOrgId: true },
  });

  if (!workspace) return null;

  // ── 2. Try AgentLog first ─────────────────────────────────────────────────
  const agentLog = await db.agentLog.findUnique({
    where: { id },
    select: {
      workspaceId: true,
      blobUrl: true,
      agent: true,
      source: true,
      metadata: true,
      config: true,
    },
  });

  if (agentLog) {
    // IDOR: verify this log belongs to the requested workspace
    if (agentLog.workspaceId !== workspace.id) {
      logger.warn(
        `[AgentEvalCapture] IDOR: agentLog ${id} belongs to workspace ${agentLog.workspaceId}, not ${workspace.id}`,
      );
      return { denied: true };
    }

    // Fetch and parse blob content
    const blobContent = await fetchBlobContent(agentLog.blobUrl);
    const { conversation, config: blobConfig } = parseAgentLogStats(blobContent);

    // Prefer DB column (canonical); fall back to blob-parsed config for legacy rows
    const effectiveConfig =
      agentLog.config && typeof agentLog.config === "object"
        ? (agentLog.config as Record<string, unknown>)
        : (blobConfig as Record<string, unknown> | undefined);

    logger.info(`[AgentEvalCapture] resolved source=agent_log trigger=${agentLog.source ?? "unknown"}`);

    return {
      kind: "agent_log",
      workspaceId: agentLog.workspaceId,
      blobUrl: agentLog.blobUrl,
      agent: agentLog.agent,
      source: agentLog.source,
      metadata: agentLog.metadata,
      config: agentLog.config,
      conversation,
      effectiveConfig,
    };
  }

  // ── 3. Fall back to SharedConversation ────────────────────────────────────
  //
  // Mirrors the exact ownership fallback in:
  //   GET /api/workspaces/[slug]/chat/conversations/[conversationId]/route.ts
  //
  // Primary: match by workspaceId
  let conversation = await db.sharedConversation.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, workspaceId: true, sourceControlOrgId: true, source: true, messages: true },
  });

  // Fallback: org-scoped canvas/graph-walk sessions (workspaceId is null for these)
  if (!conversation && workspace.sourceControlOrgId) {
    conversation = await db.sharedConversation.findFirst({
      where: {
        id,
        sourceControlOrgId: workspace.sourceControlOrgId,
        source: { in: ["org-canvas", "graph-walk"] },
      },
      select: { id: true, workspaceId: true, sourceControlOrgId: true, source: true, messages: true },
    });
  }

  if (!conversation) {
    return null;
  }

  // IDOR: if workspaceId is set, it must match; org-fallback is already scoped
  // by org ownership, which was gated by getWorkspaceSwarmAccess above.
  if (conversation.workspaceId !== null && conversation.workspaceId !== workspace.id) {
    logger.warn(
      `[AgentEvalCapture] IDOR: conversation ${id} belongs to workspace ${conversation.workspaceId}, not ${workspace.id}`,
    );
    return { denied: true };
  }

  const rawMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const parsedMessages = chatMessagesToParsedMessages(
    rawMessages as unknown as Parameters<typeof chatMessagesToParsedMessages>[0],
  );

  logger.info(`[AgentEvalCapture] resolved source=conversation trigger=canvas_chat`);

  return {
    kind: "conversation",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    source: conversation.source,
    conversation: parsedMessages,
  };
}
