import { listConcepts } from "@/lib/ai/askTools";
import { db } from "@/lib/db";
import { createFeature } from "@/services/roadmap/features";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { createTicket } from "@/services/roadmap/tickets";
import { sendMessageToStakwork } from "@/services/task-workflow";
import { writePromptThrough } from "@/services/prompts/prompt-sync";
import {
  getResolvedPrompt,
  listPromptVersions,
  getResolvedPromptVersion,
} from "@/services/prompts/prompt-read";
import { isDevelopmentMode } from "@/lib/runtime";
import type { PullRequestContent } from "@/lib/chat";
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

/**
 * Workflow tasks are a Stakwork-workflow concept and are only supported
 * on the `stakwork` workspace (or any workspace in development mode).
 * Mirrors the gate used for the workflow editor / execution surface
 * (see `task-workflow.ts`, `stakwork-run.ts`, `workflow-editor/route.ts`).
 *
 * Used as the single source of truth for the `create_workflow_task`
 * tool — both the MCP handler's runtime guard and the implementation
 * below short-circuit through it, so the surface cannot widen by
 * accident.
 */
export function isWorkflowTasksEnabled(auth: WorkspaceAuth): boolean {
  return auth.workspaceSlug === "stakwork" || isDevelopmentMode();
}

function mcpOk(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Canonical Hive URLs
// ---------------------------------------------------------------------------

/**
 * Public base URL for the Hive app. Single source of truth for the
 * web links surfaced through MCP tool results so agents can hand the
 * user a real, clickable URL instead of guessing one (the cause of
 * fabricated links like `hive.stakwork.com/.../features/<id>`).
 */
const HIVE_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  "https://hive.sphinx.chat";

/** Canonical web link to a feature's plan page. */
export function featureLink(workspaceSlug: string, featureId: string): string {
  return `${HIVE_BASE_URL}/w/${workspaceSlug}/plan/${featureId}`;
}

/** Canonical web link to a task page. */
export function taskLink(workspaceSlug: string, taskId: string): string {
  return `${HIVE_BASE_URL}/w/${workspaceSlug}/task/${taskId}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Artifact types we include in chat history responses. */
const CHAT_ARTIFACT_TYPES = [
  ArtifactType.LONGFORM,
  ArtifactType.BROWSER,
  ArtifactType.PLAN,
  ArtifactType.FORM,
];

/**
 * Artifact types where only the *last* occurrence is kept (to reduce payload).
 *
 * FORM is included here so the canvas/manager agent sees the planner's most
 * recent clarifying question (the structured options the user would see on
 * the feature plan page) without dragging along every stale form across a
 * long chat history. PLAN and BROWSER follow the same "latest snapshot only"
 * convention for the same reason.
 */
const LAST_ONLY_ARTIFACT_TYPES: ArtifactType[] = [
  ArtifactType.BROWSER,
  ArtifactType.PLAN,
  ArtifactType.FORM,
];

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

/** Maps the PR artifact's lifecycle status to a familiar GitHub PR state. */
const PR_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "open",
  DONE: "merged",
  CANCELLED: "closed",
};

/**
 * Shape a PULL_REQUEST artifact into a compact, structured summary the agent
 * can act on. Pure (no DB) so it can be unit-tested directly.
 *
 * Includes `progress` (CI status, mergeability, conflicts) when the PR monitor
 * has populated it, so the agent gets actionable PR health rather than just an
 * open/merged/closed label.
 */
export function shapePullRequestSummary(
  artifact: { id: string; content: unknown } | null,
) {
  if (!artifact?.content) return null;

  const content = artifact.content as PullRequestContent;
  const progress = content.progress;

  return {
    id: artifact.id,
    url: content.url,
    repo: content.repo,
    status: content.status,
    statusLabel: PR_STATUS_LABEL[content.status] ?? content.status,
    progress: progress
      ? {
          state: progress.state,
          mergeable: progress.mergeable,
          ciStatus: progress.ciStatus,
          ciSummary: progress.ciSummary,
          problemDetails: progress.problemDetails,
          conflictFiles: progress.conflictFiles,
          failedChecks: progress.failedChecks,
          lastCheckedAt: progress.lastCheckedAt,
        }
      : null,
  };
}

/**
 * Fetch the most recent PULL_REQUEST artifact for a task and shape it.
 *
 * Surfaced as a dedicated top-level field (rather than buried in chatHistory)
 * so the agent reliably sees the PR. Orders by `createdAt desc` so re-runs that
 * produce multiple PR artifacts always resolve to the latest one.
 */
async function fetchLatestPullRequestForMcp(taskId: string) {
  const prArtifact = await db.artifact.findFirst({
    where: { type: ArtifactType.PULL_REQUEST, message: { taskId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true },
  });

  return shapePullRequestSummary(prArtifact);
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
 *
 * Resolution order:
 *   1. `userHint` fuzzy-match against workspace members (when supplied).
 *   2. `fallbackUserId` (when supplied) — a context-specific default,
 *      e.g. the feature's creator for feature-anchored task tools, so
 *      attribution (and therefore the GitHub token that authors the PR)
 *      follows the person who owns the feature rather than collapsing to
 *      the workspace owner.
 *   3. The workspace owner — the last resort.
 */
export async function resolveWorkspaceUser(
  workspaceId: string,
  userHint?: string,
  fallbackUserId?: string,
): Promise<string> {
  if (userHint) {
    const matched = await findWorkspaceUser(workspaceId, userHint);
    if (matched) return matched;
  }

  // No hint or no match — prefer the caller-supplied fallback (e.g. the
  // feature creator) before collapsing to the workspace owner.
  if (fallbackUserId) return fallbackUserId;

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
      `${credentials.swarmUrl}/gitree/concepts/${encodeURIComponent(conceptId)}`,
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
      data.concept?.documentation || data.feature?.documentation || "No documentation available";
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
        link: featureLink(auth.workspaceSlug, f.id),
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
      link: featureLink(auth.workspaceSlug, feature!.id),
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
 * When `featureId` is provided, scopes to tasks belonging to that feature
 * (and verifies the feature belongs to the workspace first).
 */
export async function mcpListTasks(
  auth: WorkspaceAuth,
  featureId?: string,
): Promise<McpToolResult> {
  try {
    if (featureId) {
      const feature = await db.feature.findUnique({
        where: { id: featureId },
        select: { workspaceId: true },
      });
      const err = verifyWorkspace(feature, auth, "Feature");
      if (err) return err;
    }

    const tasks = await db.task.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
        ...(featureId ? { featureId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        updatedAt: true,
        featureId: true,
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
        featureId: t.featureId,
        updatedAt: t.updatedAt.toISOString(),
        link: taskLink(auth.workspaceSlug, t.id),
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

    const [chatHistory, pullRequest] = await Promise.all([
      fetchChatHistoryForMcp({ taskId }),
      fetchLatestPullRequestForMcp(taskId),
    ]);

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
      link: taskLink(auth.workspaceSlug, task!.id),
      chatHistory,
      pullRequest,
    });
  } catch (error) {
    console.error("Error reading task:", error);
    return mcpError("Error: Could not read task");
  }
}

/**
 * Create a new task in the workspace.
 * When `featureId` is provided, the task is attached to that feature
 * (after verifying the feature belongs to this workspace).
 */
export async function mcpCreateTask(
  auth: WorkspaceAuth,
  title: string,
  description?: string,
  priority?: string,
  featureId?: string,
): Promise<McpToolResult> {
  try {
    if (featureId) {
      const feature = await db.feature.findUnique({
        where: { id: featureId },
        select: { workspaceId: true },
      });
      const err = verifyWorkspace(feature, auth, "Feature");
      if (err) return err;
    }

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
        ...(featureId ? { featureId } : {}),
      },
    });

    return mcpOk({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      featureId: task.featureId,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    const msg =
      error instanceof Error ? error.message : "Could not create task";
    return mcpError(`Error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Roadmap task creation (feature-aware, via createTicket service)
// ---------------------------------------------------------------------------

/**
 * Shared input for the two roadmap-aware create helpers below.
 * Pulled into a separate type to keep `mcpCreateFeatureTask` and
 * `mcpCreateWorkflowTask` honest about their narrow contracts —
 * neither accepts `status`, `assigneeId`, or `phaseId`; both default
 * to the feature's first phase and TaskStatus.TODO via `createTicket`.
 */
interface McpRoadmapTaskBase {
  title: string;
  description?: string;
  priority?: string;
  dependsOnTaskIds?: string[];
}

/**
 * Resolve a repository identifier against a workspace. Accepts either
 * a `repositoryId` (cuid) or a `repositoryUrl` (string match against
 * `Repository.repositoryUrl`). When both are provided, `repositoryId`
 * wins. Returns the resolved cuid or an error.
 */
async function resolveWorkspaceRepository(
  workspaceId: string,
  args: { repositoryId?: string; repositoryUrl?: string },
): Promise<{ repositoryId: string } | { error: string }> {
  if (args.repositoryId) {
    const repo = await db.repository.findFirst({
      where: { id: args.repositoryId, workspaceId },
      select: { id: true },
    });
    if (!repo) {
      return { error: "Repository not found in this workspace" };
    }
    return { repositoryId: repo.id };
  }

  if (args.repositoryUrl) {
    const repo = await db.repository.findFirst({
      where: { workspaceId, repositoryUrl: args.repositoryUrl },
      select: { id: true },
    });
    if (!repo) {
      return {
        error: `No repository in this workspace matches repositoryUrl=${args.repositoryUrl}`,
      };
    }
    return { repositoryId: repo.id };
  }

  return { error: "Either repositoryId or repositoryUrl must be provided" };
}

/**
 * Create a feature-anchored CODING task.
 *
 * Wraps `createTicket` (the same path the UI uses) so the new row gets
 * the full validation, phase defaulting, bounty code, Pusher
 * broadcast, etc. — the MCP surface only adds the repository-resolver
 * convenience (accepting `repositoryUrl` in addition to
 * `repositoryId`) and the MCP error/JSON shape.
 *
 * Why a separate tool from the generic `mcpCreateTask`? The generic
 * version is feature-agnostic and used by other agents (voice, etc.)
 * that don't need to set `featureId` / `repositoryId`. The plan
 * agent needs the feature-anchored variant with task-quality
 * guardrails baked into the tool description (see handler.ts).
 */
export async function mcpCreateFeatureTask(
  auth: WorkspaceAuth,
  featureId: string,
  base: McpRoadmapTaskBase,
  repo: { repositoryId?: string; repositoryUrl?: string },
  creatorHint?: string,
): Promise<McpToolResult> {
  try {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true, createdById: true },
    });
    const err = verifyWorkspace(feature, auth, "Feature");
    if (err) return err;

    const resolved = await resolveWorkspaceRepository(auth.workspaceId, repo);
    if ("error" in resolved) {
      return mcpError(`Error: ${resolved.error}`);
    }

    const taskPriority =
      base.priority &&
      Object.values(Priority).includes(base.priority as Priority)
        ? (base.priority as Priority)
        : Priority.MEDIUM;

    // Attribution: explicit `creator` hint → the feature's creator →
    // workspace owner. Defaulting to the feature creator (rather than the
    // owner) keeps the PR authored by the person who owns the feature.
    const creatorId = await resolveWorkspaceUser(
      auth.workspaceId,
      creatorHint,
      feature!.createdById,
    );

    const task = await createTicket(featureId, creatorId, {
      title: base.title,
      description: base.description,
      priority: taskPriority,
      repositoryId: resolved.repositoryId,
      dependsOnTaskIds: base.dependsOnTaskIds,
    });

    return mcpOk({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      featureId: task.featureId,
      phaseId: task.phaseId,
      repository: task.repository,
    });
  } catch (error) {
    console.error("Error creating feature coding task:", error);
    const msg =
      error instanceof Error
        ? error.message
        : "Could not create feature coding task";
    return mcpError(`Error: ${msg}`);
  }
}

/**
 * Create a feature-anchored WORKFLOW task (Stakwork workflow editor).
 *
 * Sets `mode: "workflow_editor"` internally via `createTicket` (which
 * derives mode from `workflowId` / `isNewWorkflow`). When
 * `workflowId` is provided → existing workflow. When omitted → new
 * workflow (we pass `isNewWorkflow: true`).
 *
 * `repositoryId` is intentionally null on workflow tasks — `createTicket`
 * enforces the workflow-vs-repo mutual exclusion.
 */
export async function mcpCreateWorkflowTask(
  auth: WorkspaceAuth,
  featureId: string,
  base: McpRoadmapTaskBase,
  workflow: {
    workflowId?: number;
    workflowName?: string;
    workflowRefId?: string;
    workflowTaskType?: import("@prisma/client").WorkflowTaskType;
  },
  creatorHint?: string,
): Promise<McpToolResult> {
  try {
    if (!isWorkflowTasksEnabled(auth)) {
      return mcpError(
        "Error: workflow tasks are only supported on the stakwork workspace",
      );
    }

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true, createdById: true },
    });
    const err = verifyWorkspace(feature, auth, "Feature");
    if (err) return err;

    const taskPriority =
      base.priority &&
      Object.values(Priority).includes(base.priority as Priority)
        ? (base.priority as Priority)
        : Priority.MEDIUM;

    const hasExistingWorkflow = typeof workflow.workflowId === "number";

    // Attribution: explicit `creator` hint → the feature's creator →
    // workspace owner (mirrors mcpCreateFeatureTask).
    const creatorId = await resolveWorkspaceUser(
      auth.workspaceId,
      creatorHint,
      feature!.createdById,
    );

    const task = await createTicket(featureId, creatorId, {
      title: base.title,
      description: base.description,
      priority: taskPriority,
      dependsOnTaskIds: base.dependsOnTaskIds,
      workflowTaskType: workflow.workflowTaskType,
      ...(hasExistingWorkflow
        ? {
            workflowId: workflow.workflowId,
            workflowName: workflow.workflowName,
            workflowRefId: workflow.workflowRefId,
          }
        : { isNewWorkflow: true }),
    });

    return mcpOk({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      featureId: task.featureId,
      phaseId: task.phaseId,
      workflowId: hasExistingWorkflow ? workflow.workflowId : null,
      isNewWorkflow: !hasExistingWorkflow,
    });
  } catch (error) {
    console.error("Error creating feature workflow task:", error);
    const msg =
      error instanceof Error
        ? error.message
        : "Could not create feature workflow task";
    return mcpError(`Error: ${msg}`);
  }
}

/**
 * Update a task's editable fields. Only `title`, `description`, and
 * `priority` are updatable here — status / workflowStatus / featureId
 * changes are intentionally excluded (those are higher-impact and flow
 * through other paths).
 *
 * All three fields are optional; pass only what you want to change.
 * Empty-string `description` clears the description (set to null);
 * undefined leaves it untouched.
 */
export async function mcpUpdateTask(
  auth: WorkspaceAuth,
  taskId: string,
  updates: {
    title?: string;
    description?: string;
    priority?: string;
    dependsOnTaskIds?: string[];
  },
): Promise<McpToolResult> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    const err = verifyWorkspace(task, auth, "Task");
    if (err) return err;

    const data: {
      title?: string;
      description?: string | null;
      priority?: Priority;
      dependsOnTaskIds?: string[];
      updatedById: string;
    } = { updatedById: auth.userId };

    if (updates.title !== undefined) {
      const trimmed = updates.title.trim();
      if (!trimmed) {
        return mcpError("Error: title cannot be empty");
      }
      data.title = trimmed;
    }

    if (updates.description !== undefined) {
      const trimmed = updates.description.trim();
      data.description = trimmed.length ? trimmed : null;
    }

    if (updates.priority !== undefined) {
      if (!Object.values(Priority).includes(updates.priority as Priority)) {
        return mcpError(
          `Error: invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`,
        );
      }
      data.priority = updates.priority as Priority;
    }

    if (updates.dependsOnTaskIds !== undefined) {
      if (updates.dependsOnTaskIds.length > 0) {
        const depCount = await db.task.count({
          where: {
            id: { in: updates.dependsOnTaskIds },
            workspaceId: auth.workspaceId,
          },
        });
        if (depCount !== updates.dependsOnTaskIds.length) {
          return mcpError(
            "Error: one or more dependency task IDs do not belong to this workspace",
          );
        }
      }
      data.dependsOnTaskIds = updates.dependsOnTaskIds;
    }

    // Nothing actually changed beyond updatedById — short-circuit.
    if (Object.keys(data).length === 1) {
      return mcpError(
        "Error: no updatable fields provided (title, description, priority, dependsOnTaskIds)",
      );
    }

    const updated = await db.task.update({
      where: { id: taskId },
      data,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        featureId: true,
        dependsOnTaskIds: true,
        updatedAt: true,
      },
    });

    return mcpOk({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      featureId: updated.featureId,
      dependsOnTaskIds: updated.dependsOnTaskIds,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error updating task:", error);
    const msg =
      error instanceof Error ? error.message : "Could not update task";
    return mcpError(`Error: ${msg}`);
  }
}

/**
 * Send a message from the feature planner (or any orchestrating agent)
 * to a task's agent chat. Mirrors `send_to_feature_planner` in
 * `initiativeTools.ts` — fire-and-forget delegation, async reply,
 * fails when the task agent is currently running.
 *
 * The message is prefixed with `[via plan agent]` so the task agent
 * can recognize the upstream coordination signal.
 */
export async function mcpSendToTaskAgent(
  auth: WorkspaceAuth,
  taskId: string,
  message: string,
): Promise<McpToolResult> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true, workflowStatus: true },
    });
    const err = verifyWorkspace(task, auth, "Task");
    if (err) return err;

    // Same guard as send_to_feature_planner: don't try to send while a
    // run is already in flight. The downstream service would throw;
    // returning a structured error here is friendlier to the caller.
    if (task!.workflowStatus === "IN_PROGRESS") {
      return mcpError(
        "Error: The task agent is currently running. Use read_task to check workflowStatus and wait until it leaves IN_PROGRESS before sending.",
      );
    }

    const prefixedMessage = `[via plan agent] ${message}`;

    await sendMessageToStakwork({
      taskId,
      message: prefixedMessage,
      userId: auth.userId,
    });

    return mcpOk({
      status: "sent",
      taskId,
      awaitingReply: true,
      note: "Message delivered. The task agent replies asynchronously. Call read_task afterward to see the reply and updated state.",
    });
  } catch (error) {
    console.error("Error sending message to task agent:", error);
    const msg =
      error instanceof Error
        ? error.message
        : "Could not send message to task agent";
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
      link: taskLink(auth.workspaceSlug, t.id),
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
      link: featureLink(auth.workspaceSlug, f.id),
      brief: f.brief,
    })),
  ];

  merged.sort(statusItemComparator);
  return merged;
}

// ---------------------------------------------------------------------------
// Prompt tools (stakwork-workspace-gated)
// ---------------------------------------------------------------------------

/**
 * Create a new versioned prompt template in the Hive prompt library.
 * Name must be UPPERCASE_UNDERSCORE; duplicate names are rejected.
 */
export async function mcpCreatePrompt(
  auth: WorkspaceAuth,
  name: string,
  value: string,
  description?: string,
): Promise<McpToolResult> {
  try {
    const { prompt, version } = await writePromptThrough({
      name,
      value,
      description,
      userId: auth.userId,
    });

    return mcpOk({
      id: prompt.id,
      name: prompt.name,
      value: prompt.value,
      description: prompt.description,
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
  } catch (error) {
    console.error("Error creating prompt:", error);
    const status = (error as { status?: number }).status;
    if (status === 400) {
      return mcpError(
        "Error: prompt name must contain only uppercase letters, digits, and underscores",
      );
    }
    if (status === 409) {
      return mcpError("Error: a prompt with that name already exists");
    }
    const msg =
      error instanceof Error ? error.message : "Could not create prompt";
    return mcpError(`Error: ${msg}`);
  }
}

/**
 * Push a new version of an existing prompt. Prior versions are preserved —
 * this does NOT overwrite history. Only value and description are updatable
 * (no rename).
 */
export async function mcpUpdatePrompt(
  auth: WorkspaceAuth,
  promptId: string,
  value: string,
  description?: string,
): Promise<McpToolResult> {
  try {
    const { prompt, version } = await writePromptThrough({
      promptId,
      name: "", // resolved internally by writePromptThrough when promptId is set
      value,
      description,
      userId: auth.userId,
    });

    return mcpOk({
      id: prompt.id,
      name: prompt.name,
      value: version.value,
      description: version.description,
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
  } catch (error) {
    console.error("Error updating prompt:", error);
    const status = (error as { status?: number }).status;
    if (status === 404) {
      return mcpError("Error: prompt not found");
    }
    const msg =
      error instanceof Error ? error.message : "Could not update prompt";
    return mcpError(`Error: ${msg}`);
  }
}

// ─── Prompt Read Tools ────────────────────────────────────────────────────────

/**
 * Fetch a prompt by id or name and return the fully resolved text of its
 * published/live version. No workspace gate — available to all authenticated callers.
 */
export async function mcpGetPrompt(
  _auth: WorkspaceAuth,
  idOrName: string,
  variables: Record<string, string>,
): Promise<McpToolResult> {
  const result = await getResolvedPrompt(idOrName, variables);

  if ("notFound" in result) {
    return mcpError(`Error: prompt '${idOrName}' not found`);
  }
  if ("error" in result) {
    return mcpError(`Error: ${result.error}`);
  }

  return mcpOk({
    id: result.id,
    name: result.name,
    versionId: result.versionId,
    versionNumber: result.versionNumber,
    resolvedText: result.resolvedText,
    missingVariables: result.missingVariables,
  });
}

/**
 * List all versions of a prompt with published/current markers.
 * Use to pick a specific version for deterministic eval replay via get_prompt_version.
 */
export async function mcpGetPromptVersions(
  _auth: WorkspaceAuth,
  idOrName: string,
): Promise<McpToolResult> {
  const result = await listPromptVersions(idOrName);

  if ("notFound" in result) {
    return mcpError(`Error: prompt '${idOrName}' not found`);
  }
  if ("error" in result) {
    return mcpError(`Error: ${result.error}`);
  }

  return mcpOk(result);
}

/**
 * Fetch and resolve a specific version of a prompt by version id.
 * IDOR-guarded: versionId must belong to the prompt resolved from idOrName.
 */
export async function mcpGetPromptVersion(
  _auth: WorkspaceAuth,
  idOrName: string,
  versionId: string,
  variables: Record<string, string>,
): Promise<McpToolResult> {
  const result = await getResolvedPromptVersion(idOrName, versionId, variables);

  if ("notFound" in result) {
    return mcpError(`Error: version '${versionId}' not found for prompt '${idOrName}'`);
  }
  if ("error" in result) {
    return mcpError(`Error: ${result.error}`);
  }

  return mcpOk({
    id: result.id,
    name: result.name,
    versionId: result.versionId,
    versionNumber: result.versionNumber,
    resolvedText: result.resolvedText,
    missingVariables: result.missingVariables,
  });
}
