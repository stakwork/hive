/**
 * Multi-User Workspace Scenario
 * 
 * Creates comprehensive test environment with workspace, multiple users with different roles,
 * and sample tasks. Enables full workflow testing with role-based access control.
 */

import type { Scenario, ScenarioResult } from "../types";
import { safeResetDatabase, createScenarioMetadata } from "../utils";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { USER_VALUES, WORKSPACE_VALUES, TASK_VALUES } from "@/__tests__/support/values";

async function execute(): Promise<ScenarioResult> {
  try {
    // Reset database first
    await safeResetDatabase();

    // Create workspace with multiple members using different roles
    const scenario = await createTestWorkspaceScenario({
      owner: {
        email: USER_VALUES.mockAuthUser.email,
        name: USER_VALUES.mockAuthUser.name,
        role: "USER",
      },
      members: [
        { role: "ADMIN", user: { name: USER_VALUES.namedUsers.admin.name, email: USER_VALUES.namedUsers.admin.email } },
        { role: "PM", user: { name: USER_VALUES.namedUsers.pm.name, email: USER_VALUES.namedUsers.pm.email } },
        { role: "DEVELOPER", user: { name: USER_VALUES.namedUsers.developer.name, email: USER_VALUES.namedUsers.developer.email } },
        { role: "VIEWER", user: { name: USER_VALUES.namedUsers.viewer.name, email: USER_VALUES.namedUsers.viewer.email } },
      ],
      workspace: {
        name: WORKSPACE_VALUES.namedWorkspaces.engineering.name,
        slug: WORKSPACE_VALUES.namedWorkspaces.engineering.slug,
        description: WORKSPACE_VALUES.namedWorkspaces.engineering.description,
      },
    });

    // Create sample tasks with different statuses
    const tasks = await Promise.all([
      createTestTask({
        workspaceId: scenario.workspace.id,
        title: TASK_VALUES.namedTasks.setupDatabase.title,
        description: TASK_VALUES.namedTasks.setupDatabase.description,
        status: "TODO",
        createdById: scenario.owner.id,
        idempotent: true,
      }),
      createTestTask({
        workspaceId: scenario.workspace.id,
        title: TASK_VALUES.namedTasks.implementAuth.title,
        description: TASK_VALUES.namedTasks.implementAuth.description,
        status: "IN_PROGRESS",
        assigneeId: scenario.members[2]?.id,
        createdById: scenario.owner.id,
        idempotent: true,
      }),
      createTestTask({
        workspaceId: scenario.workspace.id,
        title: TASK_VALUES.namedTasks.writeTests.title,
        description: TASK_VALUES.namedTasks.writeTests.description,
        status: "TODO",
        createdById: scenario.members[0]?.id,
        idempotent: true,
      }),
      createTestTask({
        workspaceId: scenario.workspace.id,
        title: TASK_VALUES.namedTasks.fixBug.title,
        description: TASK_VALUES.namedTasks.fixBug.description,
        status: "CANCELLED",
        assigneeId: scenario.members[2]?.id,
        createdById: scenario.members[1]?.id,
        idempotent: true,
      }),
      createTestTask({
        workspaceId: scenario.workspace.id,
        title: TASK_VALUES.namedTasks.deployProd.title,
        description: TASK_VALUES.namedTasks.deployProd.description,
        status: "DONE",
        createdById: scenario.owner.id,
        idempotent: true,
      }),
    ]);

    return {
      success: true,
      message: "Multi-user workspace created successfully with sample tasks",
      data: {
        workspaceId: scenario.workspace.id,
        workspaceSlug: scenario.workspace.slug,
        ownerId: scenario.owner.id,
        ownerEmail: scenario.owner.email,
        memberCount: scenario.members.length,
        taskCount: tasks.length,
        members: scenario.members.map((m) => ({ id: m.id, email: m.email })),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create multi-user workspace",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const multiUserWorkspaceScenario: Scenario = {
  id: "multi-user-workspace",
  name: "multi-user-workspace",
  description: "Create workspace with multiple users (different roles) and sample tasks",
  execute,
  metadata: createScenarioMetadata({
    tags: ["workspace", "multi-user", "tasks", "roles", "comprehensive"],
    description: "Full workflow scenario with workspace, members, and task data",
    author: "Hive Team",
  }),
};
