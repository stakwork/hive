/**
 * Layer 2: Full Session Assembly
 *
 * Builds the complete end-to-end record of a feature, from human description
 * through planning, task execution, and PR. Assembled on the fly from existing data.
 */

import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import {
  parseAgentLogStats,
  type ParsedMessage,
  type ToolCallContent,
  type OpenAIToolCall,
} from "@/lib/utils/agent-log-stats";
import { computeFeatureMetrics, type FileAction } from "./metrics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FullSession {
  featureId: string;
  featureTitle: string;
  workspaceName: string;
  featureStatus: string;
  createdAt: string;
  completedAt: string | null;

  planning: {
    humanMessages: string[];
    agentTranscript: TranscriptEntry[];
    planOutput: {
      brief: string | null;
      requirements: string | null;
      architecture: string | null;
      userStories: string[];
    };
  };

  execution: PhaseSession[];

  metrics: {
    planPrecision: number | null;
    planRecall: number | null;
    totalMessages: number;
    totalCorrections: number;
  };
}

export interface PhaseSession {
  phaseName: string | null;
  phaseDescription: string | null;
  tasks: TaskSession[];
}

export interface TaskSession {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  workflowStatus: string | null;
  description: string | null;
  agentTranscripts: AgentTranscript[];
  filesTouched: FileAction[];
  prUrl: string | null;
  prStatus: string | null;
  ciPassedFirstAttempt: boolean | null;
  durationMinutes: number | null;
  messageCount: number;
  correctionCount: number;
}

export interface AgentTranscript {
  agentName: string;
  entries: TranscriptEntry[];
}

export interface TranscriptEntry {
  role: string;
  text?: string;
  reasoning?: string;
  toolCalls?: TranscriptToolCall[];
}

export interface TranscriptToolCall {
  toolName: string;
  input?: unknown;
}

// ---------------------------------------------------------------------------
// Parse agent log blob into transcript entries
// ---------------------------------------------------------------------------

function parsedMessageToTranscriptEntry(
  msg: ParsedMessage
): TranscriptEntry | null {
  // Skip tool-result / tool role messages (they're massive, all file contents)
  if (msg.role === "tool" || msg.role === "tool-result") return null;

  const entry: TranscriptEntry = { role: msg.role };

  // Extract text content
  if (typeof msg.content === "string") {
    entry.text = msg.content;
  } else if (Array.isArray(msg.content)) {
    const textParts: string[] = [];
    const toolCalls: TranscriptToolCall[] = [];

    for (const part of msg.content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && "text" in part && part.text) {
        textParts.push(part.text as string);
      } else if (part.type === "tool-call") {
        const tc = part as ToolCallContent;
        toolCalls.push({ toolName: tc.toolName, input: tc.input });
      }
      // tool-result parts are skipped (they contain file contents, etc.)
    }

    if (textParts.length > 0) entry.text = textParts.join("\n");
    if (toolCalls.length > 0) entry.toolCalls = toolCalls;
  }

  // OpenAI format tool calls
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const toolCalls: TranscriptToolCall[] = msg.tool_calls
      .filter(
        (tc: OpenAIToolCall) =>
          tc.type === "function" && tc.function?.name
      )
      .map((tc: OpenAIToolCall) => {
        let input: unknown = undefined;
        if (tc.function.arguments) {
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = tc.function.arguments;
          }
        }
        return { toolName: tc.function.name, input };
      });
    entry.toolCalls = [...(entry.toolCalls || []), ...toolCalls];
  }

  // Reasoning
  if (msg.reasoning) entry.reasoning = msg.reasoning;

  // Skip empty entries
  if (!entry.text && !entry.reasoning && !entry.toolCalls?.length) return null;

  return entry;
}

async function fetchAgentTranscript(
  blobUrl: string
): Promise<TranscriptEntry[]> {
  try {
    const content = await fetchBlobContent(blobUrl);
    const { conversation } = parseAgentLogStats(content);
    return conversation
      .map(parsedMessageToTranscriptEntry)
      .filter((e): e is TranscriptEntry => e !== null);
  } catch (error) {
    console.error(`Failed to fetch agent log from ${blobUrl}:`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Assemble full session for a feature
// ---------------------------------------------------------------------------

export async function assembleFullSession(
  featureId: string
): Promise<FullSession> {
  // Fetch feature with all related data
  const feature = await db.feature.findUniqueOrThrow({
    where: { id: featureId },
    include: {
      workspace: { select: { name: true } },
      userStories: { select: { title: true }, orderBy: { order: "asc" } },
      phases: {
        where: { deleted: false },
        include: {
          tasks: {
            where: { deleted: false },
            orderBy: { order: "asc" },
            select: { id: true },
          },
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

  // Fetch all agent logs for this feature (plan agent logs)
  const featureLogs = await db.agentLog.findMany({
    where: { featureId, taskId: null },
    orderBy: { createdAt: "asc" },
    select: { agent: true, blobUrl: true, createdAt: true },
  });

  // Fetch feature chat messages (human messages during planning)
  const featureChatMessages = await db.chatMessage.findMany({
    where: { featureId, taskId: null, role: "USER" },
    orderBy: { timestamp: "asc" },
    select: { message: true },
  });

  // Build plan agent transcript
  const planTranscript: TranscriptEntry[] = [];
  for (const log of featureLogs) {
    const entries = await fetchAgentTranscript(log.blobUrl);
    planTranscript.push(...entries);
  }

  // Compute metrics
  const featureMetrics = await computeFeatureMetrics(featureId);

  // Build execution phases
  const execution: PhaseSession[] = [];

  // Phased tasks
  for (const phase of feature.phases) {
    const taskSessions = await Promise.all(
      phase.tasks.map((t) => assembleTaskSession(t.id))
    );
    execution.push({
      phaseName: phase.name,
      phaseDescription: phase.description,
      tasks: taskSessions,
    });
  }

  // Unphased tasks (directly on feature)
  if (feature.tasks.length > 0) {
    const taskSessions = await Promise.all(
      feature.tasks.map((t) => assembleTaskSession(t.id))
    );
    execution.push({
      phaseName: null,
      phaseDescription: null,
      tasks: taskSessions,
    });
  }

  return {
    featureId: feature.id,
    featureTitle: feature.title,
    workspaceName: feature.workspace.name,
    featureStatus: feature.status,
    createdAt: feature.createdAt.toISOString(),
    completedAt: feature.workflowCompletedAt?.toISOString() || null,

    planning: {
      humanMessages: featureChatMessages.map((m) => m.message),
      agentTranscript: planTranscript,
      planOutput: {
        brief: feature.brief,
        requirements: feature.requirements,
        architecture: feature.architecture,
        userStories: feature.userStories.map((us) => us.title),
      },
    },

    execution,

    metrics: {
      planPrecision: featureMetrics.planPrecision,
      planRecall: featureMetrics.planRecall,
      totalMessages: featureMetrics.totalMessages,
      totalCorrections: featureMetrics.totalCorrections,
    },
  };
}

// ---------------------------------------------------------------------------
// Assemble a single task session
// ---------------------------------------------------------------------------

async function assembleTaskSession(taskId: string): Promise<TaskSession> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      status: true,
      workflowStatus: true,
      description: true,
      workflowStartedAt: true,
      workflowCompletedAt: true,
      haltRetryAttempted: true,
    },
  });

  // Fetch agent logs for this task, grouped by agent
  const taskLogs = await db.agentLog.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: { agent: true, blobUrl: true, createdAt: true },
  });

  // Group logs by agent name
  const logsByAgent = new Map<
    string,
    Array<{ blobUrl: string; createdAt: Date }>
  >();
  for (const log of taskLogs) {
    const existing = logsByAgent.get(log.agent) || [];
    existing.push({ blobUrl: log.blobUrl, createdAt: log.createdAt });
    logsByAgent.set(log.agent, existing);
  }

  // Build transcript per agent
  const agentTranscripts: AgentTranscript[] = [];
  for (const [agentName, logs] of logsByAgent) {
    const allEntries: TranscriptEntry[] = [];
    for (const log of logs) {
      const entries = await fetchAgentTranscript(log.blobUrl);
      allEntries.push(...entries);
    }
    agentTranscripts.push({ agentName, entries: allEntries });
  }

  // Interleave human chat messages into the coding agent transcript
  const humanMessages = await db.chatMessage.findMany({
    where: { taskId, role: "USER" },
    orderBy: { timestamp: "asc" },
    select: { message: true },
  });

  // Artifacts
  const artifacts = await db.artifact.findMany({
    where: { message: { taskId } },
    select: { type: true, content: true },
  });

  const diffArtifacts = artifacts.filter((a) => a.type === "DIFF");
  const prArtifacts = artifacts.filter((a) => a.type === "PULL_REQUEST");

  const filesTouched = extractFilesFromDiffs(diffArtifacts);
  const prInfo = extractPrInfo(prArtifacts);

  const durationMinutes =
    task.workflowStartedAt && task.workflowCompletedAt
      ? Math.round(
          (task.workflowCompletedAt.getTime() -
            task.workflowStartedAt.getTime()) /
            60000
        )
      : null;

  const messageCount = humanMessages.length;
  const correctionCount =
    messageCount <= 1
      ? 0
      : humanMessages
          .slice(1)
          .filter((m) => !isAffirmation(m.message)).length;

  return {
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    workflowStatus: task.workflowStatus,
    description: task.description,
    agentTranscripts,
    filesTouched,
    prUrl: prInfo.url,
    prStatus: prInfo.status,
    ciPassedFirstAttempt:
      prInfo.status === "DONE" ? !task.haltRetryAttempted : null,
    durationMinutes,
    messageCount,
    correctionCount,
  };
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from metrics.ts to avoid circular deps)
// ---------------------------------------------------------------------------

interface DiffActionResult {
  file?: string;
  action?: string;
}

function normalizeFilePath(path: string): string {
  const firstSlash = path.indexOf("/");
  if (firstSlash > 0) {
    const firstSegment = path.slice(0, firstSlash);
    if (!firstSegment.includes(".")) {
      return path.slice(firstSlash + 1);
    }
  }
  return path;
}

function extractFilesFromDiffs(
  artifacts: Array<{ content: unknown }>
): FileAction[] {
  const fileMap = new Map<string, string>();
  for (const artifact of artifacts) {
    const raw = artifact.content;
    if (!raw) continue;

    let items: DiffActionResult[];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (
      typeof raw === "object" &&
      Array.isArray((raw as Record<string, unknown>).diffs)
    ) {
      items = (raw as Record<string, unknown>).diffs as DiffActionResult[];
    } else {
      continue;
    }

    for (const item of items) {
      if (item.file) {
        const normalized = normalizeFilePath(item.file);
        fileMap.set(normalized, item.action || "modify");
      }
    }
  }
  return Array.from(fileMap.entries()).map(([file, action]) => ({
    file,
    action,
  }));
}

function extractPrInfo(
  artifacts: Array<{ content: unknown }>
): { url: string | null; status: string | null } {
  for (const a of artifacts) {
    const content = a.content as { url?: string; status?: string } | null;
    if (content?.url) {
      return { url: content.url, status: content.status || null };
    }
  }
  return { url: null, status: null };
}

const AFFIRMATIONS = new Set([
  "yes", "ok", "y", "go", "sure", "do it", "looks good", "proceed",
  "continue", "approved", "lgtm", "next", "go ahead", "yep", "yup",
  "yeah", "correct", "right", "perfect", "great", "good", "fine",
  "agreed", "confirmed", "ship it", "merge it", "thanks", "thank you",
  "cool", "nice", "done", "k", "okay",
]);

function isAffirmation(msg: string): boolean {
  const normalized = msg.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (AFFIRMATIONS.has(normalized)) return true;
  if (normalized.length < 10) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Serialize a full session to text (for LLM input)
// ---------------------------------------------------------------------------

export function sessionToText(session: FullSession): string {
  const lines: string[] = [];

  lines.push(`FEATURE: ${session.featureTitle}`);
  lines.push(`Workspace: ${session.workspaceName}`);
  lines.push(`Status: ${session.featureStatus}`);
  lines.push(
    `Created: ${session.createdAt}${session.completedAt ? ` | Completed: ${session.completedAt}` : ""}`
  );
  lines.push("");

  // Planning
  lines.push("--- PLANNING PHASE ---");
  lines.push("");

  if (session.planning.humanMessages.length > 0) {
    lines.push("Human's original request:");
    for (const msg of session.planning.humanMessages) {
      lines.push(`  [USER] ${msg}`);
    }
    lines.push("");
  }

  if (session.planning.agentTranscript.length > 0) {
    lines.push("Plan agent transcript:");
    for (const entry of session.planning.agentTranscript) {
      lines.push(formatTranscriptEntry(entry, "  "));
    }
    lines.push("");
  }

  const plan = session.planning.planOutput;
  lines.push("Plan output:");
  if (plan.brief) lines.push(`  Brief: ${plan.brief}`);
  if (plan.requirements)
    lines.push(`  Requirements: ${truncate(plan.requirements, 500)}`);
  if (plan.architecture)
    lines.push(`  Architecture: ${truncate(plan.architecture, 1000)}`);
  if (plan.userStories.length > 0) {
    lines.push(`  User Stories: ${plan.userStories.join(", ")}`);
  }
  lines.push("");

  // Execution
  lines.push("--- EXECUTION PHASE ---");
  lines.push("");

  for (const phase of session.execution) {
    if (phase.phaseName) {
      lines.push(`PHASE: ${phase.phaseName}${phase.phaseDescription ? ` — ${phase.phaseDescription}` : ""}`);
      lines.push("");
    }

    for (const task of phase.tasks) {
      lines.push(`  TASK: ${task.taskTitle}`);
      if (task.description) lines.push(`  Description: ${truncate(task.description, 300)}`);
      lines.push(`  Status: ${task.taskStatus} | Workflow: ${task.workflowStatus || "N/A"}`);
      lines.push(
        `  Messages: ${task.messageCount} | Corrections: ${task.correctionCount}${task.durationMinutes ? ` | Duration: ${task.durationMinutes}min` : ""}`
      );
      lines.push("");

      for (const agent of task.agentTranscripts) {
        lines.push(`  ${agent.agentName} agent transcript:`);
        for (const entry of agent.entries) {
          lines.push(formatTranscriptEntry(entry, "    "));
        }
        lines.push("");
      }

      if (task.filesTouched.length > 0) {
        lines.push("  Files touched:");
        for (const f of task.filesTouched) {
          lines.push(`    - ${f.file} (${f.action})`);
        }
        lines.push("");
      }

      if (task.prUrl) {
        lines.push(
          `  PR: ${task.prUrl} — ${task.prStatus || "unknown"}${task.ciPassedFirstAttempt !== null ? ` | CI: ${task.ciPassedFirstAttempt ? "passed 1st try" : "failed 1st try"}` : ""}`
        );
        lines.push("");
      }
    }
  }

  // Metrics summary
  lines.push("--- METRICS ---");
  lines.push(`Plan precision: ${session.metrics.planPrecision ?? "N/A"}%`);
  lines.push(`Plan recall: ${session.metrics.planRecall ?? "N/A"}%`);
  lines.push(`Total messages: ${session.metrics.totalMessages}`);
  lines.push(`Total corrections: ${session.metrics.totalCorrections}`);

  return lines.join("\n");
}

function formatTranscriptEntry(entry: TranscriptEntry, indent: string): string {
  const lines: string[] = [];
  const role = entry.role.toUpperCase();

  if (entry.text) {
    lines.push(`${indent}[${role}] ${truncate(entry.text, 500)}`);
  }
  if (entry.reasoning) {
    lines.push(
      `${indent}[${role} reasoning] ${truncate(entry.reasoning, 300)}`
    );
  }
  if (entry.toolCalls) {
    for (const tc of entry.toolCalls) {
      const inputStr = tc.input
        ? JSON.stringify(tc.input).slice(0, 200)
        : "";
      lines.push(`${indent}  -> ${tc.toolName}(${inputStr})`);
    }
  }

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
