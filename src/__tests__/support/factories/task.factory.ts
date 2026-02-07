import { db } from "@/lib/db";
import type { Task, ChatMessage, Artifact, ArtifactType } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { MediaContent } from "@/lib/chat";
import {
  TASK_VALUES,
  getRandomTask,
  type TaskValueKey,
  type TaskCategory,
} from "../values/tasks";

export interface CreateTestTaskOptions {
  /** Use named value from TASK_VALUES (e.g., "loginFeature", "dashboardBug") */
  valueKey?: TaskValueKey;
  /** Generate random task by category */
  category?: TaskCategory;
  title?: string;
  description?: string;
  workspaceId: string;
  createdById: string;
  assigneeId?: string;
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "BLOCKED";
  sourceType?: "USER" | "JANITOR" | "SYSTEM" | "USER_JOURNEY";
  workflowStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | "FAILED" | "HALTED" | null;
  featureId?: string;
  phaseId?: string;
  repositoryId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  order?: number;
  dependsOnTaskIds?: string[];
  testFilePath?: string;
  testFileUrl?: string;
  stakworkProjectId?: number;
  autoMerge?: boolean;
  /** If true, return existing task if title+workspace match */
  idempotent?: boolean;
}

export interface CreateTestChatMessageOptions {
  taskId: string;
  message: string;
  role?: "USER" | "ASSISTANT" | "SYSTEM";
}

export async function createTestTask(
  options: CreateTestTaskOptions,
): Promise<Task> {
  // Get base values from valueKey, category, or generate defaults
  let baseValues;
  if (options.valueKey) {
    baseValues = TASK_VALUES[options.valueKey];
  } else if (options.category) {
    baseValues = getRandomTask(options.category);
  } else {
    baseValues = null;
  }

  const uniqueId = generateUniqueId("task");
  const title = options.title ?? baseValues?.title ?? `Test Task ${uniqueId}`;
  const description = options.description ?? baseValues?.description ?? `Test task description ${uniqueId}`;
  const status = options.status ?? baseValues?.status ?? "TODO";
  const priority = options.priority ?? baseValues?.priority ?? "MEDIUM";
  const sourceType = options.sourceType ?? baseValues?.sourceType ?? "USER";

  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.task.findFirst({
      where: {
        workspaceId: options.workspaceId,
        title,
      },
    });
    if (existing) return existing;
  }

  return db.task.create({
    data: {
      title,
      description,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.createdById,
      assigneeId: options.assigneeId ?? null,
      status,
      priority,
      sourceType,
      workflowStatus: options.workflowStatus ?? null,
      featureId: options.featureId ?? null,
      phaseId: options.phaseId ?? null,
      repositoryId: options.repositoryId ?? null,
      order: options.order ?? 0,
      dependsOnTaskIds: options.dependsOnTaskIds ?? [],
      testFilePath: options.testFilePath ?? null,
      testFileUrl: options.testFileUrl ?? null,
      stakworkProjectId: options.stakworkProjectId ?? null,
      autoMerge: options.autoMerge ?? true,
    },
  });
}

/**
 * Create multiple tasks with varied data by category distribution
 *
 * @example
 * // 10 tasks with mixed categories
 * const tasks = await createTestTasks(workspace.id, owner.id, 10);
 *
 * @example
 * // 5 bug tasks only
 * const bugs = await createTestTasks(workspace.id, owner.id, 5, { category: "bug" });
 */
export async function createTestTasks(
  workspaceId: string,
  createdById: string,
  count: number,
  options: { category?: TaskCategory } = {}
): Promise<Task[]> {
  const categories: TaskCategory[] = ["bug", "feature", "chore", "janitor"];
  const tasks: Task[] = [];

  for (let i = 0; i < count; i++) {
    const category = options.category ?? categories[i % categories.length];
    const task = await createTestTask({
      workspaceId,
      createdById,
      category,
    });
    tasks.push(task);
  }

  return tasks;
}

export async function createTestChatMessage(
  options: CreateTestChatMessageOptions,
): Promise<ChatMessage> {
  return db.chatMessage.create({
    data: {
      taskId: options.taskId,
      message: options.message,
      role: options.role || "USER",
    },
  });
}

export async function createTestTaskWithMessages(
  taskOptions: CreateTestTaskOptions,
  messageCount: number = 3,
): Promise<{ task: Task; messages: ChatMessage[] }> {
  const task = await createTestTask(taskOptions);
  const messages: ChatMessage[] = [];

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? "USER" : "ASSISTANT";
    const message = await createTestChatMessage({
      taskId: task.id,
      message: `Test message ${i + 1}`,
      role: role as "USER" | "ASSISTANT",
    });
    messages.push(message);
  }

  return { task, messages };
}

export async function findTestTask(taskId: string) {
  return db.task.findUnique({ where: { id: taskId } });
}

export async function updateTestTask(taskId: string, updates: any) {
  return db.task.update({
    where: { id: taskId },
    data: updates
  });
}

export async function deleteTestTask(taskId: string) {
  return db.task.delete({ where: { id: taskId } });
}

export interface CreateTestUserJourneyTaskOptions {
  title: string;
  description?: string;
  workspaceId: string;
  repositoryId?: string;
  createdById: string;
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  workflowStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | "FAILED" | "HALTED";
  testFilePath?: string;
  testFileUrl?: string;
  stakworkProjectId?: number;
}

export async function createTestUserJourneyTask(
  options: CreateTestUserJourneyTaskOptions,
): Promise<Task> {
  return db.task.create({
    data: {
      title: options.title,
      description: options.description || null,
      workspaceId: options.workspaceId,
      repositoryId: options.repositoryId || null,
      sourceType: "USER_JOURNEY",
      status: options.status || "TODO",
      workflowStatus: options.workflowStatus || null,
      testFilePath: options.testFilePath || null,
      testFileUrl: options.testFileUrl || null,
      stakworkProjectId: options.stakworkProjectId || null,
      createdById: options.createdById,
      updatedById: options.createdById,
    },
  });
}

export interface CreateTestArtifactOptions {
  messageId: string;
  type?: ArtifactType;
  content?: MediaContent | Record<string, any>;
  icon?: string;
  s3Key?: string;
  filename?: string;
  mediaType?: "video" | "audio";
}

export async function createTestArtifact(
  options: CreateTestArtifactOptions,
): Promise<Artifact> {
  const uniqueId = generateUniqueId("artifact");
  
  // Default to MEDIA type with proper content structure
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
