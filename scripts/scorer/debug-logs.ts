/**
 * Scorer Log Duplication Debug Script
 *
 * Checks whether agent log blobs contain cumulative or incremental conversations,
 * which would explain the "duplicate exploration" insights.
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/scorer/debug-logs.ts hive
 */

import { PrismaClient } from "@prisma/client";
import { get } from "@vercel/blob";

const prisma = new PrismaClient();

/** Fetch blob content using Vercel Blob private access (same as src/lib/utils/blob-fetch.ts) */
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

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/scorer-debug-logs.ts <workspace-slug>");
    process.exit(1);
  }

  const workspace = await prisma.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true, name: true },
  });

  if (!workspace) {
    console.error(`Workspace "${slug}" not found`);
    process.exit(1);
  }

  console.log(`\n=== Log Duplication Debug: ${workspace.name} ===\n`);

  // Find features that have multiple plan agent logs
  const featuresWithMultipleLogs = await prisma.$queryRaw<
    Array<{ feature_id: string; log_count: bigint }>
  >`
    SELECT feature_id, COUNT(*) as log_count
    FROM agent_logs
    WHERE workspace_id = ${workspace.id}
      AND feature_id IS NOT NULL
      AND task_id IS NULL
    GROUP BY feature_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;

  console.log(`--- FEATURES WITH MULTIPLE PLAN AGENT LOGS ---`);
  console.log(`Found: ${featuresWithMultipleLogs.length}\n`);

  for (const row of featuresWithMultipleLogs.slice(0, 3)) {
    const featureId = row.feature_id;
    const logCount = Number(row.log_count);

    const feature = await prisma.feature.findUnique({
      where: { id: featureId },
      select: { title: true },
    });

    console.log(`Feature: ${feature?.title} (${featureId})`);
    console.log(`  Plan agent logs: ${logCount}`);

    const logs = await prisma.agentLog.findMany({
      where: { featureId, taskId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, agent: true, blobUrl: true, createdAt: true },
    });

    // Fetch each blob and check for overlap
    const blobSummaries: Array<{
      id: string;
      agent: string;
      messageCount: number;
      firstMsg: string;
      lastMsg: string;
      createdAt: Date;
    }> = [];

    for (const log of logs) {
      try {
        const text = await fetchBlobContent(log.blobUrl);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          console.log(`  Log ${log.id}: not valid JSON`);
          continue;
        }

        let messages: Array<{ role: string; content?: unknown }> = [];
        if (Array.isArray(parsed)) {
          messages = parsed;
        } else if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as Record<string, unknown>).messages)
        ) {
          messages = (parsed as Record<string, unknown>).messages as typeof messages;
        }

        const firstRole = messages[0]?.role || "?";
        const lastRole = messages[messages.length - 1]?.role || "?";

        // Get first text content for comparison
        const getTextPreview = (msg: { content?: unknown }) => {
          if (typeof msg.content === "string") return msg.content.slice(0, 80);
          if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part && typeof part === "object" && "text" in part) {
                return String((part as { text: string }).text).slice(0, 80);
              }
            }
          }
          return "(no text)";
        };

        blobSummaries.push({
          id: log.id,
          agent: log.agent,
          messageCount: messages.length,
          firstMsg: `[${firstRole}] ${getTextPreview(messages[0] || {})}`,
          lastMsg: `[${lastRole}] ${getTextPreview(messages[messages.length - 1] || {})}`,
          createdAt: log.createdAt,
        });
      } catch (err) {
        console.log(`  Log ${log.id}: error — ${err}`);
      }
    }

    for (const s of blobSummaries) {
      console.log(`\n  Log: ${s.id} (${s.agent}, ${s.createdAt.toISOString()})`);
      console.log(`    Messages: ${s.messageCount}`);
      console.log(`    First: ${s.firstMsg}`);
      console.log(`    Last:  ${s.lastMsg}`);
    }

    // Check overlap: do later blobs start with the same first message?
    if (blobSummaries.length >= 2) {
      const first = blobSummaries[0];
      const second = blobSummaries[1];
      const sameStart = first.firstMsg === second.firstMsg;
      console.log(`\n  Same first message across blobs: ${sameStart ? "YES — CUMULATIVE (duplicated)" : "NO — incremental"}`);
      if (sameStart) {
        console.log(`  >>> Blob 1 has ${first.messageCount} msgs, Blob 2 has ${second.messageCount} msgs`);
        console.log(`  >>> If cumulative, Blob 2 contains Blob 1's messages + new ones`);
      }
    }

    console.log();
  }

  // Also check tasks with multiple logs per agent
  console.log(`\n--- TASKS WITH MULTIPLE LOGS PER AGENT ---`);

  const tasksWithMultipleLogs = await prisma.$queryRaw<
    Array<{ task_id: string; agent: string; log_count: bigint }>
  >`
    SELECT task_id, agent, COUNT(*) as log_count
    FROM agent_logs
    WHERE workspace_id = ${workspace.id}
      AND task_id IS NOT NULL
    GROUP BY task_id, agent
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `;

  console.log(`Found: ${tasksWithMultipleLogs.length}`);
  for (const row of tasksWithMultipleLogs) {
    console.log(`  Task ${row.task_id} — ${row.agent}: ${Number(row.log_count)} logs`);
  }

  console.log(`\n=== Done ===\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
