/**
 * Task Factory - Creates task entities with data from values layer
 */
import { db } from "@/lib/db";
import type { Task, ChatMessage, Artifact, ArtifactType } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { MediaContent } from "@/lib/chat";
import {
  TASK_VALUES,
  TASK_POOLS,
  getRandomTask,
  type TaskValueKey,
  type TaskCategory,
} from "../values/tasks";

export interface CreateTaskOptions {
  // Use named value from TASK_VALUES
  valueKey?: TaskValueKey;
  // Or specify category for random generation
  category?: TaskCategory;
  // Required context
  workspaceId: string;
  createdById: string;
  // Custom overrides
  title?: string;
  description?: string | null;
  status?: typeof TASK_POOLS.statuses[number];
  priority?: typeof TASK_POOLS.priorities[number];
  sourceType?: typeof TASK_POOLS.sourceTypes[number];
  workflowStatus?: typeof TASK_POOLS.workflowStatuses[number] | null;
  // Optional relations
  assigneeId?: string;
  featureId?: string;
  phaseId?: string;
  repositoryId?: string;
  // User journey specific
  testFilePath?: string;
  testFileUrl?: string;
  stakworkProjectId?: number;
  // Other options
  order?: number;
  dependsOnTaskIds?: string[];
  idempotent?: boolean;
}

/**
 * Create a single task
 *
 * @example
 * // Use named value
 * const task = await createTask({
 *   valueKey: "loginFeature",
 *   workspaceId: workspace.id,
 *   createdById: owner.id
 * });
 *
 * @example
 * // Use random values by category
 * const bugTask = await createTask({
 *   category: "bug",
 *   workspaceId: workspace.id,
 *   createdById: owner.id
 * });
 *
 * @example
 * // Use custom values
 * const task = await createTask({
 *   workspaceId: workspace.id,
 *   createdById: owner.id,
 *   title: "Custom Task",
 *   status: "IN_PROGRESS"
 * });
 */
export async function createTask(options: CreateTaskOptions): Promise<Task> {
  // Get base values from valueKey, category, or default to "feature"
  let baseValues;
  if (options.valueKey) {
    baseValues = TASK_VALUES[options.valueKey];
  } else {
    baseValues = getRandomTask(options.category || "feature");
  }

  const data = {
    title: options.title ?? baseValues.title,
    description: options.description ?? baseValues.description ?? null,
    workspaceId: options.workspaceId,
    createdById: options.createdById,
    updatedById: options.createdById,
    status: options.status ?? baseValues.status ?? "TODO",
    priority: options.priority ?? baseValues.priority ?? "MEDIUM",
    sourceType: options.sourceType ?? baseValues.sourceType ?? "USER",
    workflowStatus: options.workflowStatus ?? null,
    assigneeId: options.assigneeId ?? null,
    featureId: options.featureId ?? null,
    phaseId: options.phaseId ?? null,
    repositoryId: options.repositoryId ?? null,
    testFilePath: options.testFilePath ?? null,
    testFileUrl: options.testFileUrl ?? null,
    stakworkProjectId: options.stakworkProjectId ?? null,
    order: options.order ?? 0,
    dependsOnTaskIds: options.dependsOnTaskIds ?? [],
  };

  // Idempotent: check if exists by title in workspace
  if (options.idempotent) {
    const existing = await db.task.findFirst({
      where: {
        workspaceId: data.workspaceId,
        title: data.title,
      },
    });
    if (existing) return existing;
  }

  return db.task.create({ data });
}

/**
 * Create multiple tasks with varied data by category distribution
 *
 * @example
 * // 10 tasks with mixed categories
 * const tasks = await createTasks(workspace.id, owner.id, 10);
 *
 * @example
 * // 5 bug tasks only
 * const bugs = await createTasks(workspace.id, owner.id, 5, { category: "bug" });
 */
export async function createTasks(
  workspaceId: string,
  createdById: string,
  count: number,
  options: { category?: TaskCategory } = {}
): Promise<Task[]> {
  const categories: TaskCategory[] = ["bug", "feature", "chore", "janitor"];
  const tasks: Task[] = [];

  for (let i = 0; i < count; i++) {
    const category = options.category ?? categories[i % categories.length];
    const task = await createTask({
      workspaceId,
      createdById,
      category,
    });
    tasks.push(task);
  }

  return tasks;
}

export interface CreateChatMessageOptions {
  taskId: string;
  message: string;
  role?: "USER" | "ASSISTANT" | "SYSTEM";
}

/**
 * Create a chat message on a task
 */
export async function createChatMessage(options: CreateChatMessageOptions): Promise<ChatMessage> {
  return db.chatMessage.create({
    data: {
      taskId: options.taskId,
      message: options.message,
      role: options.role || "USER",
    },
  });
}

/**
 * Create a task with chat messages
 */
export async function createTaskWithMessages(
  taskOptions: CreateTaskOptions,
  messageCount: number = 3
): Promise<{ task: Task; messages: ChatMessage[] }> {
  const task = await createTask(taskOptions);
  const messages: ChatMessage[] = [];

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? "USER" : "ASSISTANT";
    const message = await createChatMessage({
      taskId: task.id,
      message: `Test message ${i + 1}`,
      role: role as "USER" | "ASSISTANT",
    });
    messages.push(message);
  }

  return { task, messages };
}

export interface CreateUserJourneyTaskOptions {
  title: string;
  workspaceId: string;
  createdById: string;
  description?: string;
  repositoryId?: string;
  status?: typeof TASK_POOLS.statuses[number];
  workflowStatus?: typeof TASK_POOLS.workflowStatuses[number] | null;
  testFilePath?: string;
  testFileUrl?: string;
  stakworkProjectId?: number;
  idempotent?: boolean;
}

/**
 * Create a user journey task (E2E test)
 *
 * @example
 * const ujTask = await createUserJourneyTask({
 *   title: "Login User Journey",
 *   workspaceId: workspace.id,
 *   createdById: owner.id,
 *   testFilePath: "src/__tests__/e2e/specs/auth/login.spec.ts",
 *   status: "DONE",
 *   workflowStatus: "COMPLETED"
 * });
 */
export async function createUserJourneyTask(options: CreateUserJourneyTaskOptions): Promise<Task> {
  return createTask({
    ...options,
    sourceType: "USER_JOURNEY",
  });
}

export interface CreateArtifactOptions {
  messageId: string;
  type?: ArtifactType;
  content?: MediaContent | Record<string, unknown>;
  icon?: string;
  s3Key?: string;
  filename?: string;
  mediaType?: "video" | "audio";
}

/**
 * Create an artifact (e.g., video recording) attached to a message
 */
export async function createArtifact(options: CreateArtifactOptions): Promise<Artifact> {
  const uniqueId = generateUniqueId("artifact");

  const defaultContent: MediaContent = {
    s3Key: options.s3Key || `test/artifacts/${uniqueId}.webm`,
    filename: options.filename || `test-video-${uniqueId}.webm`,
    mediaType: options.mediaType || "video",
    size: 1024000,
    contentType: options.mediaType === "audio" ? "audio/webm" : "video/webm",
    uploadedAt: new Date().toISOString(),
  };

  return db.artifact.create({
    data: {
      messageId: options.messageId,
      type: options.type || "MEDIA",
      content: options.content || defaultContent,
      icon: options.icon || null,
    },
  });
}
