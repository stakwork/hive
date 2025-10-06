import { db } from "@/lib/db";
import type { Task, ChatMessage } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestTaskOptions {
  title?: string;
  description?: string;
  workspaceId: string;
  createdById: string;
  assigneeId?: string;
  status?: "active" | "completed" | "archived";
  sourceType?: "MANUAL" | "JANITOR";
}

export interface CreateTestChatMessageOptions {
  taskId: string;
  message: string;
  role?: "USER" | "ASSISTANT" | "SYSTEM";
}

export async function createTestTask(
  options: CreateTestTaskOptions,
): Promise<Task> {
  const uniqueId = generateUniqueId("task");

  return db.task.create({
    data: {
      title: options.title || `Test Task ${uniqueId}`,
      description: options.description || `Test task description ${uniqueId}`,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      assigneeId: options.assigneeId || null,
      status: options.status || "active",
      sourceType: options.sourceType || "MANUAL",
    },
  });
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
