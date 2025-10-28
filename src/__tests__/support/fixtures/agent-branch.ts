import { db } from "@/lib/db";
import type { User, Workspace, Task, ChatMessage } from "@prisma/client";
import { generateUniqueSlug } from "@/__tests__/support/helpers";
import { createTestUser } from "./user";
import { createTestTask, createTestChatMessage } from "./task";

/**
 * Options for creating a task scenario with workspace
 */
export interface CreateTaskWithWorkspaceOptions {
  user?: User;
  taskTitle?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  withChatMessage?: boolean;
  chatMessage?: string;
}

/**
 * Result of creating a task scenario
 */
export interface TaskWithWorkspaceResult {
  user: User;
  workspace: Workspace;
  task: Task;
  chatMessage?: ChatMessage;
}

/**
 * Creates a complete scenario with user, workspace, and task
 * Commonly used pattern in agent-branch tests
 */
export async function createTaskWithWorkspace(
  options: CreateTaskWithWorkspaceOptions = {},
): Promise<TaskWithWorkspaceResult> {
  const user = options.user || (await createTestUser());

  const workspace = await db.workspace.create({
    data: {
      name: options.workspaceName || "Test Workspace",
      slug: options.workspaceSlug || generateUniqueSlug("test-workspace"),
      ownerId: user.id,
    },
  });

  const task = await createTestTask({
    title: options.taskTitle || "Test Task",
    workspaceId: workspace.id,
    createdById: user.id,
  });

  let chatMessage: ChatMessage | undefined;
  if (options.withChatMessage) {
    chatMessage = await createTestChatMessage({
      taskId: task.id,
      message: options.chatMessage || "Test message",
      role: "USER",
    });
  }

  return { user, workspace, task, chatMessage };
}

/**
 * Mock AI response structure
 */
export interface MockAIResponse {
  commit_message: string;
  branch_name: string;
}

/**
 * Creates a mock AI response with conventional commit format
 */
export function createMockAIResponse(
  category: "feat" | "fix" | "refactor" | "docs" | "test" | "chore",
  description: string,
): MockAIResponse {
  const kebabDescription = description.toLowerCase().replace(/\s+/g, "-");
  return {
    commit_message: `${category}: ${description}`,
    branch_name: `${category}/${kebabDescription}`,
  };
}

/**
 * Common branch name categories for testing
 */
export const BRANCH_CATEGORIES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "chore",
] as const;

export type BranchCategory = (typeof BRANCH_CATEGORIES)[number];
