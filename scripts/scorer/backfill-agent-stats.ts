/**
 * Backfill Agent Log Stats
 *
 * Fetches agent log blobs, parses them, and caches the stats JSON on each
 * AgentLog row. Processes in small serial batches to avoid blob rate limits.
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/scorer/backfill-agent-stats.ts <workspace-slug>
 *
 * Options:
 *   --dry-run    Count logs without processing
 *   --batch=N    Batch size (default 5)
 */

import { PrismaClient } from "@prisma/client";
import { get } from "@vercel/blob";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Blob fetch (standalone, mirrors src/lib/utils/blob-fetch.ts)
// ---------------------------------------------------------------------------

async function fetchBlobContent(url: string): Promise<string> {
  if (!url.includes(".blob.vercel-storage.com")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
    return res.text();
  }
  const pathname = new URL(url).pathname.slice(1);
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new Error(`Blob not found: ${pathname}`);
  }
  const response = new Response(result.stream);
  return response.text();
}

// ---------------------------------------------------------------------------
// Minimal parser (mirrors src/lib/utils/agent-log-stats.ts)
// ---------------------------------------------------------------------------

interface ParsedMessage {
  role: string;
  content?: string | Array<{ type: string; toolName?: string; text?: string; input?: unknown }>;
  reasoning?: string;
  tool_calls?: Array<{ type: string; function: { name: string; arguments?: string } }>;
}

function isValidMessage(msg: unknown): msg is ParsedMessage {
  return (
    msg != null &&
    typeof msg === "object" &&
    "role" in msg &&
    typeof (msg as ParsedMessage).role === "string"
  );
}

function parseAndBuildStats(content: string, log: { startedAt: Date | null; completedAt: Date | null }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  let candidates: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).messages)) {
    candidates = (parsed as Record<string, unknown>).messages as unknown[];
  }
  if (!candidates || candidates.length === 0) return null;

  const conversation = candidates.filter(isValidMessage);
  if (conversation.length === 0) return null;

  // Token estimation
  let totalChars = 0;
  for (const msg of conversation) {
    totalChars += msg.role.length;
    if (typeof msg.content === "string") totalChars += msg.content.length;
    else if (Array.isArray(msg.content)) totalChars += JSON.stringify(msg.content).length;
    if (typeof msg.reasoning === "string") totalChars += msg.reasoning.length;
  }

  // Tool calls
  const toolFrequency: Record<string, number> = {};
  const bashFrequency: Record<string, number> = {};
  const developerShellFrequency: Record<string, number> = {};
  let totalToolCalls = 0;

  for (const msg of conversation) {
    if (msg.role !== "assistant") continue;
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === "tool-call" && part.toolName) {
          toolFrequency[part.toolName] = (toolFrequency[part.toolName] ?? 0) + 1;
          totalToolCalls++;
          if (part.toolName === "bash") {
            const cmd = (part.input as { command?: string })?.command?.trim().split(" ")[0];
            if (cmd) bashFrequency[cmd] = (bashFrequency[cmd] ?? 0) + 1;
          }
          if (part.toolName === "developer__shell") {
            const cmd = (part.input as { command?: string })?.command?.trim().split(" ")[0];
            if (cmd) developerShellFrequency[cmd] = (developerShellFrequency[cmd] ?? 0) + 1;
          }
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.type === "function" && tc.function?.name) {
          const name = tc.function.name;
          toolFrequency[name] = (toolFrequency[name] ?? 0) + 1;
          totalToolCalls++;
          if (name === "bash") {
            try {
              const args = JSON.parse(tc.function.arguments ?? "{}") as { command?: string };
              const cmd = args.command?.trim().split(" ")[0];
              if (cmd) bashFrequency[cmd] = (bashFrequency[cmd] ?? 0) + 1;
            } catch { /* skip */ }
          }
          if (name === "developer__shell") {
            try {
              const args = JSON.parse(tc.function.arguments ?? "{}") as { command?: string };
              const cmd = args.command?.trim().split(" ")[0];
              if (cmd) developerShellFrequency[cmd] = (developerShellFrequency[cmd] ?? 0) + 1;
            } catch { /* skip */ }
          }
        }
      }
    }
  }

  // Conversation preview
  const conversationPreview: Array<{ role: string; text: string }> = [];
  for (const msg of conversation) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === "text" && part.text) {
          text = part.text;
          break;
        }
      }
    }
    if (!text) continue;
    conversationPreview.push({ role: msg.role, text: text.slice(0, 100) });
  }

  // Duration
  const durationSeconds =
    log.startedAt && log.completedAt
      ? Math.round((log.completedAt.getTime() - log.startedAt.getTime()) / 1000)
      : null;

  return {
    totalMessages: conversation.length,
    estimatedTokens: Math.ceil(totalChars / 4),
    durationSeconds,
    totalToolCalls,
    toolFrequency,
    bashFrequency,
    developerShellFrequency,
    conversationPreview,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/scorer/backfill-agent-stats.ts <workspace-slug> [--dry-run] [--batch=N]");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const batchSize = batchArg ? parseInt(batchArg.split("=")[1], 10) : 5;

  const workspace = await prisma.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true, name: true },
  });

  if (!workspace) {
    console.error(`Workspace "${slug}" not found`);
    process.exit(1);
  }

  const totalCount = await prisma.agentLog.count({
    where: { workspaceId: workspace.id },
  });

  const uncachedCount = await prisma.agentLog.count({
    where: { workspaceId: workspace.id, stats: null },
  });

  console.log(`Workspace: ${workspace.name} (${workspace.id})`);
  console.log(`Total agent logs: ${totalCount}`);
  console.log(`Uncached: ${uncachedCount}`);
  console.log(`Already cached: ${totalCount - uncachedCount}`);

  if (dryRun) {
    console.log("Dry run — exiting.");
    return;
  }

  if (uncachedCount === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  let processed = 0;
  let errors = 0;
  let cursor: string | undefined;

  while (true) {
    const logs = await prisma.agentLog.findMany({
      where: { workspaceId: workspace.id, stats: null },
      select: { id: true, blobUrl: true, agent: true, startedAt: true, completedAt: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (logs.length === 0) break;

    for (const log of logs) {
      cursor = log.id;
      try {
        const content = await fetchBlobContent(log.blobUrl);
        const stats = parseAndBuildStats(content, log);
        if (stats) {
          await prisma.agentLog.update({
            where: { id: log.id },
            data: { stats },
          });
          processed++;
        } else {
          // Empty/unparseable blob — write empty stats to skip on re-run
          await prisma.agentLog.update({
            where: { id: log.id },
            data: {
              stats: {
                totalMessages: 0,
                estimatedTokens: 0,
                durationSeconds: null,
                totalToolCalls: 0,
                toolFrequency: {},
                bashFrequency: {},
                developerShellFrequency: {},
                conversationPreview: [],
              },
            },
          });
          processed++;
        }
        process.stdout.write(`\rProcessed: ${processed}/${uncachedCount} (errors: ${errors})`);
      } catch (err) {
        errors++;
        console.error(`\nError processing ${log.id} (${log.agent}):`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`\nDone. Processed: ${processed}, Errors: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
