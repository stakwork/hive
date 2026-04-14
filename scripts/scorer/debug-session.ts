/**
 * Build a full session for a feature and output it to a file.
 * Uses the same code paths as the real scorer.
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/scorer/debug-session.ts "Admin Settings Route Rename"
 *
 * Output: scripts/scorer/output/session-<featureId>.txt
 */

import { PrismaClient } from "@prisma/client";
import { get } from "@vercel/blob";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Blob fetch (same as src/lib/utils/blob-fetch.ts)
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
// Agent log parsing (same as src/lib/utils/agent-log-stats.ts)
// ---------------------------------------------------------------------------

interface ParsedMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string; toolName?: string; input?: unknown }>;
  reasoning?: string;
  tool_calls?: Array<{ type: string; function: { name: string; arguments?: string } }>;
}

function isValidMessage(msg: unknown): msg is ParsedMessage {
  return msg != null && typeof msg === "object" && "role" in msg;
}

function parseConversation(content: string): ParsedMessage[] {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return []; }
  let candidates: unknown[] | null = null;
  if (Array.isArray(parsed)) candidates = parsed;
  else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).messages))
    candidates = (parsed as any).messages;
  if (!candidates) return [];
  return candidates.filter(isValidMessage);
}

// ---------------------------------------------------------------------------
// Transcript formatting (same logic as src/lib/scorer/session.ts)
// ---------------------------------------------------------------------------

function formatMessage(msg: ParsedMessage): string | null {
  if (msg.role === "tool" || msg.role === "tool-result") return null;

  const lines: string[] = [];
  const role = msg.role.toUpperCase();

  if (typeof msg.content === "string") {
    lines.push(`[${role}] ${msg.content.slice(0, 500)}`);
  } else if (Array.isArray(msg.content)) {
    const textParts: string[] = [];
    const toolCalls: string[] = [];
    for (const part of msg.content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && part.text) {
        textParts.push(part.text.slice(0, 500));
      } else if (part.type === "tool-call" && part.toolName) {
        const inputStr = part.input ? JSON.stringify(part.input).slice(0, 200) : "";
        toolCalls.push(`  -> ${part.toolName}(${inputStr})`);
      }
    }
    if (textParts.length > 0) lines.push(`[${role}] ${textParts.join("\n")}`);
    for (const tc of toolCalls) lines.push(tc);
  }

  if (msg.reasoning) {
    lines.push(`[${role} reasoning] ${msg.reasoning.slice(0, 300)}`);
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.type === "function" && tc.function?.name) {
        const inputStr = tc.function.arguments?.slice(0, 200) || "";
        lines.push(`  -> ${tc.function.name}(${inputStr})`);
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// File path helpers (same as src/lib/scorer/metrics.ts)
// ---------------------------------------------------------------------------

const FILE_PATH_RE = /(?:^|[\s`"'(,])([a-zA-Z][\w./-]*\/[\w./-]+\.\w{1,10})(?:[\s`"'),]|$)/gm;

function extractFilePaths(text: string | null): string[] {
  if (!text) return [];
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;
  while ((match = FILE_PATH_RE.exec(text)) !== null) paths.add(match[1]);
  return Array.from(paths);
}

function normalizeFilePath(path: string): string {
  const firstSlash = path.indexOf("/");
  if (firstSlash > 0 && !path.slice(0, firstSlash).includes(".")) {
    return path.slice(firstSlash + 1);
  }
  return path;
}

function extractDiffFiles(content: unknown): Array<{ file: string; action: string }> {
  let items: Array<{ file?: string; action?: string }>;
  if (Array.isArray(content)) items = content;
  else if (content && typeof content === "object" && Array.isArray((content as any).diffs))
    items = (content as any).diffs;
  else return [];
  return items
    .filter((i) => i.file)
    .map((i) => ({ file: normalizeFilePath(i.file!), action: i.action || "modify" }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const search = process.argv[2];
  if (!search) {
    console.error('Usage: npx tsx scripts/scorer-debug-session.ts "Feature Title"');
    process.exit(1);
  }

  const feature = await prisma.feature.findFirst({
    where: { title: { contains: search, mode: "insensitive" }, deleted: false },
    include: {
      workspace: { select: { name: true } },
      userStories: { select: { title: true }, orderBy: { order: "asc" } },
      phases: {
        where: { deleted: false },
        include: {
          tasks: { where: { deleted: false }, orderBy: { order: "asc" }, select: { id: true } },
        },
        orderBy: { order: "asc" },
      },
      tasks: {
        where: { deleted: false, phaseId: null },
        orderBy: { order: "asc" },
        select: { id: true },
      },
    },
  });

  if (!feature) {
    console.error(`Feature matching "${search}" not found`);
    process.exit(1);
  }

  console.log(`Found: ${feature.title} (${feature.id})`);
  console.log(`Workspace: ${feature.workspace.name}`);

  const out: string[] = [];
  out.push(`FEATURE: ${feature.title}`);
  out.push(`ID: ${feature.id}`);
  out.push(`Workspace: ${feature.workspace.name}`);
  out.push(`Status: ${feature.status}`);
  out.push(`Created: ${feature.createdAt.toISOString()}`);
  out.push("");

  // --- Planning ---
  out.push("=== PLANNING PHASE ===");
  out.push("");

  const humanMsgs = await prisma.chatMessage.findMany({
    where: { featureId: feature.id, taskId: null, role: "USER" },
    orderBy: { timestamp: "asc" },
    select: { message: true },
  });
  if (humanMsgs.length > 0) {
    out.push("Human messages:");
    for (const m of humanMsgs) out.push(`  [USER] ${m.message}`);
    out.push("");
  }

  // Plan agent logs only (filtered like the fixed session.ts)
  const planLogs = await prisma.agentLog.findMany({
    where: {
      featureId: feature.id,
      taskId: null,
      OR: [
        { agent: { startsWith: "plan-agent" } },
        { agent: { startsWith: "TASK_GENERATION-agent" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { agent: true, blobUrl: true, createdAt: true },
  });

  // Also show what we're EXCLUDING
  const allFeatureLogs = await prisma.agentLog.findMany({
    where: { featureId: feature.id, taskId: null },
    orderBy: { createdAt: "asc" },
    select: { agent: true, blobUrl: true, createdAt: true },
  });

  const excludedLogs = allFeatureLogs.filter(
    (l) => !l.agent.startsWith("plan-agent") && !l.agent.startsWith("TASK_GENERATION-agent")
  );

  out.push(`Plan agent logs: ${planLogs.length}`);
  if (excludedLogs.length > 0) {
    out.push(`EXCLUDED non-plan logs (taskId=null): ${excludedLogs.length}`);
    for (const l of excludedLogs) {
      out.push(`  - ${l.agent} (${l.createdAt.toISOString()})`);
    }
  }
  out.push("");

  for (const log of planLogs) {
    out.push(`--- ${log.agent} (${log.createdAt.toISOString()}) ---`);
    try {
      const content = await fetchBlobContent(log.blobUrl);
      const messages = parseConversation(content);
      out.push(`  Messages in blob: ${messages.length}`);
      for (const msg of messages) {
        const formatted = formatMessage(msg);
        if (formatted) out.push(`  ${formatted}`);
      }
    } catch (err) {
      out.push(`  ERROR: ${err}`);
    }
    out.push("");
  }

  // Plan output
  out.push("Plan output:");
  if (feature.brief) out.push(`  Brief: ${feature.brief}`);
  if (feature.requirements) out.push(`  Requirements: ${feature.requirements.slice(0, 500)}`);
  if (feature.architecture) out.push(`  Architecture: ${feature.architecture.slice(0, 1000)}`);
  if (feature.userStories.length > 0) {
    out.push(`  User Stories: ${feature.userStories.map((us) => us.title).join(", ")}`);
  }
  const filesPlanned = extractFilePaths(feature.architecture);
  out.push(`  Files planned (from architecture): ${filesPlanned.join(", ") || "none"}`);
  out.push("");

  // --- Execution ---
  out.push("=== EXECUTION PHASE ===");
  out.push("");

  const allTaskIds = [
    ...feature.phases.flatMap((p) => p.tasks.map((t) => t.id)),
    ...feature.tasks.map((t) => t.id),
  ];

  for (const taskId of allTaskIds) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        description: true,
        workflowStatus: true,
        workflowStartedAt: true,
        workflowCompletedAt: true,
        haltRetryAttempted: true,
        chatMessages: {
          where: { role: "USER" },
          select: { message: true },
          orderBy: { timestamp: "asc" },
        },
      },
    });
    if (!task) continue;

    const duration =
      task.workflowStartedAt && task.workflowCompletedAt
        ? Math.round((task.workflowCompletedAt.getTime() - task.workflowStartedAt.getTime()) / 60000)
        : null;

    out.push(`--- TASK: ${task.title} (${task.id}) ---`);
    out.push(`  Status: ${task.status} | Workflow: ${task.workflowStatus || "N/A"}`);
    if (task.description) out.push(`  Description: ${task.description.slice(0, 300)}`);
    out.push(`  User messages: ${task.chatMessages.length}`);
    out.push(`  Duration: ${duration ? `${duration}min` : "N/A"}`);
    out.push("");

    // Agent logs for this task
    const taskLogs = await prisma.agentLog.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      select: { agent: true, blobUrl: true, createdAt: true },
    });

    // Also check for taskId=null logs that belong to this task by agent name
    const taskSuffix = taskId;
    const orphanedLogs = excludedLogs.filter((l) => l.agent.includes(taskSuffix));
    if (orphanedLogs.length > 0) {
      out.push(`  Orphaned logs (taskId=null, agent name matches task): ${orphanedLogs.length}`);
      for (const l of orphanedLogs) out.push(`    - ${l.agent}`);
      out.push("");
    }

    for (const log of taskLogs) {
      out.push(`  Agent: ${log.agent} (${log.createdAt.toISOString()})`);
      try {
        const content = await fetchBlobContent(log.blobUrl);
        const messages = parseConversation(content);
        out.push(`  Messages in blob: ${messages.length}`);
        for (const msg of messages) {
          const formatted = formatMessage(msg);
          if (formatted) out.push(`    ${formatted}`);
        }
      } catch (err) {
        out.push(`    ERROR: ${err}`);
      }
      out.push("");
    }

    // Artifacts
    const artifacts = await prisma.artifact.findMany({
      where: { message: { taskId } },
      select: { type: true, content: true },
    });

    const diffs = artifacts.filter((a) => a.type === "DIFF");
    const prs = artifacts.filter((a) => a.type === "PULL_REQUEST");

    const filesTouched = diffs.flatMap((d) => extractDiffFiles(d.content));
    if (filesTouched.length > 0) {
      out.push(`  Files touched: ${filesTouched.length}`);
      for (const f of filesTouched) out.push(`    - ${f.file} (${f.action})`);
    }

    for (const pr of prs) {
      const c = pr.content as { url?: string; status?: string } | null;
      if (c?.url) out.push(`  PR: ${c.url} — ${c.status || "open"}`);
    }

    out.push("");
  }

  // --- Metrics summary ---
  const plannedSet = new Set(filesPlanned);
  const allTouched = new Set<string>();

  // Re-fetch all diffs for metrics
  if (allTaskIds.length > 0) {
    const allArtifacts = await prisma.artifact.findMany({
      where: { message: { taskId: { in: allTaskIds } }, type: "DIFF" },
      select: { content: true },
    });
    for (const a of allArtifacts) {
      for (const f of extractDiffFiles(a.content)) allTouched.add(f.file);
    }
  }

  const touchedArr = Array.from(allTouched);
  const overlap = touchedArr.filter((f) => plannedSet.has(f));

  out.push("=== METRICS ===");
  out.push(`Files planned: ${filesPlanned.length}`);
  out.push(`Files touched: ${touchedArr.length}`);
  out.push(`Overlap: ${overlap.length}`);
  out.push(`Precision: ${touchedArr.length > 0 ? Math.round((overlap.length / touchedArr.length) * 100) : "N/A"}%`);
  out.push(`Recall: ${filesPlanned.length > 0 ? Math.round((overlap.length / filesPlanned.length) * 100) : "N/A"}%`);

  // Write output
  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `session-${feature.id}.txt`);
  writeFileSync(outPath, out.join("\n"), "utf-8");

  console.log(`\nWritten to: ${outPath}`);
  console.log(`Lines: ${out.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
