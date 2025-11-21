import { db } from "@/lib/db";
import type { Task, ChatMessage } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestTaskOptions {
  title?: string;
  description?: string;
  workspaceId: string;
  createdById: string;
  assigneeId?: string;
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  sourceType?: "USER" | "JANITOR" | "SYSTEM";
  featureId?: string;
  phaseId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  order?: number;
}

export interface CreateTestChatMessageOptions {
  taskId: string;
  message: string;
  role?: "USER" | "ASSISTANT" | "SYSTEM";
}

export async function createTestTask(options: CreateTestTaskOptions): Promise<Task> {
  const uniqueId = generateUniqueId("task");

  return db.task.create({
    data: {
      title: options.title || `Test Task ${uniqueId}`,
      description: options.description || `Test task description ${uniqueId}`,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.createdById, // Required field
      assigneeId: options.assigneeId || null,
      status: options.status || "TODO",
      priority: options.priority || "MEDIUM",
      sourceType: options.sourceType || "USER",
      featureId: options.featureId || null,
      phaseId: options.phaseId || null,
      order: options.order !== undefined ? options.order : 0,
    },
  });
}

export async function createTestChatMessage(options: CreateTestChatMessageOptions): Promise<ChatMessage> {
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
    data: updates,
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

export async function createTestUserJourneyTask(options: CreateTestUserJourneyTaskOptions): Promise<Task> {
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
