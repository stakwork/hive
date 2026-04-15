/**
 * Agent Stats Service
 *
 * Parses agent log blobs and caches the results in the AgentLog.stats JSON field.
 * Provides read helpers for the scorer UI and backfill for existing data.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import {
  parseAgentLogStats,
  type AgentLogStats,
  type ParsedMessage,
} from "@/lib/utils/agent-log-stats";
import type { AgentLog } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLogStatsJson extends AgentLogStats {
  durationSeconds: number | null;
  conversationPreview: Array<{ role: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_TYPE_PREFIXES: [string, string][] = [
  ["plan-agent", "plan"],
  ["TASK_GENERATION-agent", "task_generation"],
  ["coding-agent", "coding"],
  ["build-agent", "build"],
  ["test-agent", "test"],
  ["browser-agent", "browser"],
];

export function extractAgentType(agentName: string): string {
  for (const [prefix, type] of AGENT_TYPE_PREFIXES) {
    if (agentName.startsWith(prefix)) return type;
  }
  return "unknown";
}

function buildConversationPreview(
  messages: ParsedMessage[]
): Array<{ role: string; text: string }> {
  const preview: Array<{ role: string; text: string }> = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          part != null &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          text = part.text;
          break;
        }
      }
    }
    if (!text) continue;
    preview.push({ role: msg.role, text: text.slice(0, 100) });
  }
  return preview;
}

function computeDurationSeconds(log: AgentLog): number | null {
  if (!log.startedAt || !log.completedAt) return null;
  return Math.round(
    (log.completedAt.getTime() - log.startedAt.getTime()) / 1000
  );
}

// ---------------------------------------------------------------------------
// Cache a single agent log
// ---------------------------------------------------------------------------

/**
 * Parse + cache stats for a single agent log.
 * Skips if stats are already populated. Returns the (possibly updated) row.
 */
export async function cacheAgentLogStats(
  agentLogId: string
): Promise<AgentLog> {
  const log = await db.agentLog.findUniqueOrThrow({
    where: { id: agentLogId },
  });

  if (log.stats) return log;

  const content = await fetchBlobContent(log.blobUrl);
  const { conversation, stats } = parseAgentLogStats(content);
  const conversationPreview = buildConversationPreview(conversation);
  const durationSeconds = computeDurationSeconds(log);

  const statsJson: AgentLogStatsJson = {
    ...stats,
    durationSeconds,
    conversationPreview,
  };

  return db.agentLog.update({
    where: { id: agentLogId },
    data: { stats: statsJson as unknown as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------------------
// Cache all agent logs for a feature
// ---------------------------------------------------------------------------

/**
 * Parse + cache stats for all agent logs in a feature.
 * Skips logs that already have stats populated.
 */
export async function cacheFeatureAgentStats(
  featureId: string
): Promise<void> {
  const logs = await db.agentLog.findMany({
    where: { featureId, stats: { equals: Prisma.DbNull } },
    select: { id: true },
  });

  for (const log of logs) {
    try {
      await cacheAgentLogStats(log.id);
    } catch (error) {
      console.error(
        `Failed to cache stats for agent log ${log.id}:`,
        error
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill an entire workspace
// ---------------------------------------------------------------------------

const BACKFILL_BATCH_SIZE = 5;

/**
 * Parse + cache stats for all agent logs in a workspace.
 * Processes in small serial batches to avoid overwhelming blob storage.
 */
export async function backfillWorkspaceAgentStats(
  workspaceId: string
): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined;

  while (true) {
    const logs = await db.agentLog.findMany({
      where: { workspaceId },
      select: { id: true, stats: true },
      orderBy: { id: "asc" },
      take: BACKFILL_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (logs.length === 0) break;

    for (const log of logs) {
      cursor = log.id;
      if (log.stats) {
        skipped++;
        continue;
      }
      try {
        await cacheAgentLogStats(log.id);
        processed++;
      } catch (error) {
        errors++;
        console.error(
          `Backfill error for agent log ${log.id}:`,
          error
        );
      }
    }
  }

  return { processed, skipped, errors };
}

// ---------------------------------------------------------------------------
// Read cached stats
// ---------------------------------------------------------------------------

/** Read agent logs with cached stats for a task. */
export async function getTaskAgentStats(
  taskId: string
): Promise<AgentLog[]> {
  return db.agentLog.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
}

/** Read agent logs with cached stats for a feature. */
export async function getFeatureAgentStats(
  featureId: string
): Promise<AgentLog[]> {
  return db.agentLog.findMany({
    where: { featureId },
    orderBy: { createdAt: "asc" },
  });
}
