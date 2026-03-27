import { listConcepts } from "@/lib/ai/askTools";
import { db } from "@/lib/db";
import { createFeature } from "@/services/roadmap/features";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { sendMessageToStakwork } from "@/services/task-workflow";
import {
  ArtifactType,
  Priority,
  TaskStatus,
  FeatureStatus,
} from "@prisma/client";

export interface SwarmCredentials {
  swarmUrl: string;
  swarmApiKey: string;
}

export interface WorkspaceAuth {
  workspaceId: string;
  workspaceSlug: string;
  userId: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function mcpError(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function mcpOk(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Artifact types we include in chat history responses. */
const CHAT_ARTIFACT_TYPES = [ArtifactType.LONGFORM, ArtifactType.BROWSER, ArtifactType.PLAN];

/** Artifact types where only the *last* occurrence is kept (to reduce payload). */
const LAST_ONLY_ARTIFACT_TYPES: ArtifactType[] = [ArtifactType.BROWSER, ArtifactType.PLAN];

type RawMessage = {
  role: string;
  message: string;
  createdAt: Date;
  createdBy: { name: string | null } | null;
  artifacts: { type: ArtifactType; content: unknown }[];
};

/**
 * Fetch chat messages for a feature or task and collapse last-only artifacts.
 */
async function fetchChatHistoryForMcp(
  filter: { featureId: string } | { taskId: string },
) {
  const messages: RawMessage[] = await db.chatMessage.findMany({
    where: filter,
    include: {
      artifacts: {
        where: { type: { in: CHAT_ARTIFACT_TYPES } },
        select: { type: true, content: true },
      },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // For last-only types, record which message index holds the final occurrence
  const lastIndexOf: Partial<Record<ArtifactType, number>> = {};
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const a of messages[i].artifacts) {
      if (LAST_ONLY_ARTIFACT_TYPES.includes(a.type) && !(a.type in lastIndexOf)) {
        lastIndexOf[a.type] = i;
      }
    }
    if (LAST_ONLY_ARTIFACT_TYPES.every((t) => t in lastIndexOf)) break;
  }

  return messages.map((msg, idx) => ({
    role: msg.role,
    message: msg.message,
    createdBy: msg.createdBy?.name || null,
    createdAt: msg.createdAt.toISOString(),
    artifacts: msg.artifacts
      .filter((a) => !LAST_ONLY_ARTIFACT_TYPES.includes(a.type) || lastIndexOf[a.type] === idx)
      .map((a) => ({ type: a.type, content: a.content })),
  }));
}

/**
 * Verify a record belongs to the expected workspace, returning an error if not.
 */
function verifyWorkspace(
  record: { workspaceId: string } | null,
  auth: WorkspaceAuth,
  label: string,
): McpToolResult | null {
  if (!record) return mcpError(`Error: ${label} not found`);
  if (record.workspaceId !== auth.workspaceId) {
    return mcpError(`Error: ${label} does not belong to this workspace`);
  }
  return null;
}

/**
 * Fuzzy-match a `userHint` against workspace member names / aliases.
 * Returns the matched userId, or undefined when no match is found.
 */
export async function findWorkspaceUser(
  workspaceId: string,
  userHint: string,
): Promise<string | undefined> {
  const lower = userHint.toLowerCase();

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerId: true,
      owner: {
        select: { id: true, name: true, sphinxAlias: true },
      },
      members: {
        where: { leftAt: null },
        select: {
          user: {
            select: { id: true, name: true, sphinxAlias: true },
          },
        },
      },
    },
  });

  if (!workspace) return undefined;

  // Collect all candidate users (owner + members), deduped
  const candidates = new Map<
    string,
    { id: string; name: string | null; sphinxAlias: string | null }
  >();
  if (workspace.owner) {
    candidates.set(workspace.owner.id, workspace.owner);
  }
  for (const m of workspace.members) {
    if (m.user) candidates.set(m.user.id, m.user);
  }

  // Exact match first
  for (const user of candidates.values()) {
    if (
      (user.name && user.name.toLowerCase() === lower) ||
      (user.sphinxAlias && user.sphinxAlias.toLowerCase() === lower)
    ) {
      return user.id;
    }
  }

  // Softer "contains" fuzzy match
  for (const user of candidates.values()) {
    if (
      (user.name && user.name.toLowerCase().includes(lower)) ||
      (user.sphinxAlias && user.sphinxAlias.toLowerCase().includes(lower))
    ) {
      return user.id;
    }
  }

  return undefined;
}

/**
 * Resolve a user within a workspace by fuzzy-matching the `user` string
 * against User.name and User.sphinxAlias (case-insensitive).
 * Falls back to the workspace owner when no match is found.
 */
export async function resolveWorkspaceUser(
  workspaceId: string,
  userHint?: string,
): Promise<string> {
  if (userHint) {
    const matched = await findWorkspaceUser(workspaceId, userHint);
    if (matched) return matched;
  }

  // No hint or no match — fall back to owner
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!workspace) throw new Error("Workspace not found");
  return workspace.ownerId;
}

/**
 * List all concepts/features from the codebase knowledge base
 */
export async function mcpListConcepts(
  credentials: SwarmCredentials,
): Promise<McpToolResult> {
  try {
    const result = await listConcepts(
      credentials.swarmUrl,
      credentials.swarmApiKey,
    );
    return mcpOk(result);
  } catch (error) {
    console.error("Error listing concepts:", error);
    return mcpError("Error: Could not retrieve concepts");
  }
}

/**
 * Fetch documentation for a specific concept by ID
 */
export async function mcpLearnConcept(
  credentials: SwarmCredentials,
  conceptId: string,
): Promise<McpToolResult> {
  try {
    const res = await fetch(
      `${credentials.swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": credentials.swarmApiKey,
        },
      },
    );

    if (!res.ok) return mcpError("Error: Concept not found");

    const data = await res.json();
    const documentation =
      data.feature?.documentation || "No documentation available";
    return { content: [{ type: "text", text: documentation }] };
  } catch (error) {
    console.error("Error fetching concept:", error);
    return mcpError("Error: Could not retrieve concept documentation");
  }
}

// ---------------------------------------------------------------------------
// Feature tools (DB-direct, no swarm required)
// ---------------------------------------------------------------------------

/**
 * List features for a workspace, ordered by last updated, max 40.
 * Returns only feature names and IDs.
 */
export async function mcpListFeatures(
  auth: WorkspaceAuth,
): Promise<McpToolResult> {
  try {
    const features = await db.feature.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });

    return mcpOk(
      features.map((f) => ({
        id: f.id,
        title: f.title,
        status: f.status,
        updatedAt: f.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error("Error listing features:", error);
    return mcpError("Error: Could not list features");
  }
}

/**
 * Read a feature's chat message history and current workflow status.
 */
export async function mcpReadFeature(
  auth: WorkspaceAuth,
  featureId: string,
): Promise<McpToolResult> {
  try {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        status: true,
        workspaceId: true,
        workflowStatus: true,
        brief: true,
        requirements: true,
        architecture: true,
      },
    });

    const err = verifyWorkspace(feature, auth, "Feature");
    if (err) return err;

    const chatHistory = await fetchChatHistoryForMcp({ featureId });

    return mcpOk({
      id: feature!.id,
      title: feature!.title,
      status: feature!.status,
      workflowStatus: feature!.workflowStatus,
      isWorkflowRunning: feature!.workflowStatus === "IN_PROGRESS",
      brief: feature!.brief,
      requirements: feature!.requirements,
      architecture: feature!.architecture,
      chatHistory,
    });
  } catch (error) {
    console.error("Error reading feature:", error);
    return mcpError("Error: Could not read feature");
  }
}

/**
 * Create a new feature with a brief and optional requirements,
 * then send the brief as the first chat message to kick off the
 * AI planning workflow (same as the UI flow).
 */
export async function mcpCreateFeature(
  auth: WorkspaceAuth,
  title: string,
  brief: string,
  requirements?: string,
): Promise<McpToolResult> {
  try {
    const feature = await createFeature(auth.userId, {
      title,
      workspaceId: auth.workspaceId,
      brief,
      requirements: requirements || undefined,
    });

    // Send the brief as the first chat message to trigger the planning workflow
    const initialMessage = requirements
      ? `${brief}\n\nPreliminary Requirements:\n${requirements}`
      : brief;

    await sendFeatureChatMessage({
      featureId: feature.id,
      userId: auth.userId,
      message: initialMessage,
    });

    return mcpOk({
      id: feature.id,
      title: feature.title,
      status: feature.status,
      workflowStarted: true,
    });
  } catch (error) {
    console.error("Error creating feature:", error);
    const msg =
      error instanceof Error ? error.message : "Could not create feature";
    return mcpError(`Error: ${msg}`);
  }
}

/**
 * Send a message to a feature (planning chat) or a task (agent chat).
 * Exactly one of featureId / taskId must be provided.
 */
export async function mcpSendMessage(
  auth: WorkspaceAuth,
  message: string,
  featureId?: string,
  taskId?: string,
): Promise<McpToolResult> {
  if (!featureId && !taskId) {
    return mcpError("Error: Either featureId or taskId must be provided");
  }
  if (featureId && taskId) {
    return mcpError("Error: Provide only one of featureId or taskId, not both");
  }

  try {
    if (featureId) {
      const feature = await db.feature.findUnique({
        where: { id: featureId },
        select: { workspaceId: true },
      });
      const err = verifyWorkspace(feature, auth, "Feature");
      if (err) return err;

      await sendFeatureChatMessage({ featureId, userId: auth.userId, message });
      return mcpOk({ sent: true, target: "feature", featureId });
    } else {
      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { workspaceId: true },
      });
      const err = verifyWorkspace(task, auth, "Task");
      if (err) return err;

      await sendMessageToStakwork({ taskId: taskId!, message, userId: auth.userId });
      return mcpOk({ sent: true, target: "task", taskId });
    }
  } catch (error) {
    console.error("Error sending message:", error);
    const msg =
      error instanceof Error ? error.message : "Could not send message";
    return mcpError(`Error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Task tools (DB-direct, no swarm required)
// ---------------------------------------------------------------------------

/**
 * List tasks for a workspace, ordered by last updated, max 40.
 */
export async function mcpListTasks(
  auth: WorkspaceAuth,
): Promise<McpToolResult> {
  try {
    const tasks = await db.task.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });

    return mcpOk(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error("Error listing tasks:", error);
    return mcpError("Error: Could not list tasks");
  }
}

/**
 * Read a task's details and full chat message history.
 */
export async function mcpReadTask(
  auth: WorkspaceAuth,
  taskId: string,
): Promise<McpToolResult> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        workspaceId: true,
        workflowStatus: true,
        featureId: true,
        branch: true,
      },
    });

    const err = verifyWorkspace(task, auth, "Task");
    if (err) return err;

    const chatHistory = await fetchChatHistoryForMcp({ taskId });

    return mcpOk({
      id: task!.id,
      title: task!.title,
      description: task!.description,
      status: task!.status,
      priority: task!.priority,
      workflowStatus: task!.workflowStatus,
      isWorkflowRunning: task!.workflowStatus === "IN_PROGRESS",
      featureId: task!.featureId,
      branch: task!.branch,
      chatHistory,
    });
  } catch (error) {
    console.error("Error reading task:", error);
    return mcpError("Error: Could not read task");
  }
}

/**
 * Create a new task in the workspace.
 */
export async function mcpCreateTask(
  auth: WorkspaceAuth,
  title: string,
  description?: string,
  priority?: string,
): Promise<McpToolResult> {
  try {
    const taskPriority =
      priority && Object.values(Priority).includes(priority as Priority)
        ? (priority as Priority)
        : Priority.MEDIUM;

    const task = await db.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        workspaceId: auth.workspaceId,
        priority: taskPriority,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });

    return mcpOk({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    const msg =
      error instanceof Error ? error.message : "Could not create task";
    return mcpError(`Error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Check status (unified features + tasks view)
// ---------------------------------------------------------------------------

const LOOKBACK_DAYS = 7;
const TARGET_COUNT = 12;

/** Terminal statuses we exclude — these don't need attention. */
const TERMINAL_TASK_STATUSES: TaskStatus[] = [TaskStatus.DONE, TaskStatus.CANCELLED];
const TERMINAL_FEATURE_STATUSES: FeatureStatus[] = [FeatureStatus.COMPLETED, FeatureStatus.CANCELLED];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * Unified status check: returns up to 12 items (features + tasks) ordered by
 * needsAttention (workflowStatus === COMPLETED) first, then most-recent-first.
 * Only items updated within the last 7 days are included.
 * When filterUserId is provided, only items created by or assigned to that
 * user are returned.
 */
// ---------------------------------------------------------------------------
// Stakgraph code-graph tools (swarm-backed)
// TODO: add mcpStakgraphMap, mcpStakgraphNodes, mcpStakgraphCode
// ---------------------------------------------------------------------------

/**
 * Search the code graph using fulltext, vector (semantic), or hybrid (RRF) search.
 */
export async function mcpStakgraphSearch(
  credentials: SwarmCredentials,
  params: {
    query: string;
    method?: string;
    node_types?: string[];
    limit?: number;
    language?: string;
    concise?: boolean;
  },
): Promise<McpToolResult> {
  try {
    const url = new URL(`${credentials.swarmUrl}/search`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("method", params.method || "hybrid");
    url.searchParams.set("output", "json");
    if (params.node_types?.length)
      url.searchParams.set("node_types", params.node_types.join(","));
    if (params.limit != null)
      url.searchParams.set("limit", String(params.limit));
    if (params.language)
      url.searchParams.set("language", params.language);
    if (params.concise)
      url.searchParams.set("concise", "true");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-token": credentials.swarmApiKey },
    });

    if (!res.ok)
      return mcpError(`Error: Stakgraph search failed (${res.status})`);

    const data = await res.json();
    return mcpOk(data);
  } catch (error) {
    console.error("Error in stakgraph search:", error);
    return mcpError("Error: Could not search the code graph");
  }
}

/**
 * Ask a natural-language question about the codebase.
 * Runs the decompose → explore (hybrid search) → recompose pipeline and returns a synthesised answer.
 */
export async function mcpStakgraphAsk(
  credentials: SwarmCredentials,
  params: { question: string },
): Promise<McpToolResult> {
  try {
    const url = new URL(`${credentials.swarmUrl}/ask`);
    url.searchParams.set("question", params.question);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-token": credentials.swarmApiKey },
    });

    if (!res.ok)
      return mcpError(`Error: Stakgraph ask failed (${res.status})`);

    const data = await res.json();
    return mcpOk(data);
  } catch (error) {
    console.error("Error in stakgraph ask:", error);
    return mcpError("Error: Could not query the code graph");
  }
}

export async function mcpCheckStatus(
  auth: WorkspaceAuth,
  filterUserId?: string,
): Promise<McpToolResult> {
  try {
    const items = await fetchStatusItems(auth, filterUserId);
    return mcpOk(items.slice(0, TARGET_COUNT));
  } catch (error) {
    console.error("Error checking status:", error);
    return mcpError("Error: Could not check status");
  }
}

interface StatusItem {
  type: "feature" | "task";
  id: string;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  needsAttention: boolean;
  updatedAt: string;
  link: string;
  brief?: string | null;
  branch?: string | null;
}

function statusItemComparator(a: StatusItem, b: StatusItem): number {
  if (a.needsAttention !== b.needsAttention) {
    return a.needsAttention ? -1 : 1;
  }
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * Fetch features and tasks updated within the last LOOKBACK_DAYS.
 * When filterUserId is provided, only returns items where that user matches
 * createdById OR assigneeId.
 */
async function fetchStatusItems(
  auth: WorkspaceAuth,
  filterUserId?: string,
): Promise<StatusItem[]> {
  const cutoff = daysAgo(LOOKBACK_DAYS);

  // When a specific user was requested, scope to items they created or are assigned to
  const userFilter = filterUserId
    ? { OR: [{ createdById: filterUserId }, { assigneeId: filterUserId }] }
    : {};

  const [tasks, features] = await Promise.all([
    db.task.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
        archived: false,
        status: { notIn: TERMINAL_TASK_STATUSES },
        updatedAt: { gte: cutoff },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        branch: true,
      },
      orderBy: { updatedAt: "desc" },
      take: TARGET_COUNT,
    }),
    db.feature.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
        status: { notIn: TERMINAL_FEATURE_STATUSES },
        updatedAt: { gte: cutoff },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        brief: true,
      },
      orderBy: { updatedAt: "desc" },
      take: TARGET_COUNT,
    }),
  ]);

  const base = `https://hive.sphinx.chat/w/${auth.workspaceSlug}`;

  const merged: StatusItem[] = [
    ...tasks.map((t) => ({
      type: "task" as const,
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      workflowStatus: t.workflowStatus,
      needsAttention: t.workflowStatus === "COMPLETED",
      updatedAt: t.updatedAt.toISOString(),
      link: `${base}/task/${t.id}`,
      branch: t.branch,
    })),
    ...features.map((f) => ({
      type: "feature" as const,
      id: f.id,
      title: f.title,
      status: f.status,
      priority: f.priority,
      workflowStatus: f.workflowStatus,
      needsAttention: f.workflowStatus === "COMPLETED",
      updatedAt: f.updatedAt.toISOString(),
      link: `${base}/plan/${f.id}`,
      brief: f.brief,
    })),
  ];

  merged.sort(statusItemComparator);
  return merged;
}
