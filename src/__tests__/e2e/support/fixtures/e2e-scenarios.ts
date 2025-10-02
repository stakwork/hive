/**
 * E2E Test Scenarios
 *
 * Pre-configured test scenarios for common E2E test setups.
 * These provide consistent, reproducible test data.
 */

import {
  createTestWorkspaceScenario,
  createTestTask,
  type TestWorkspaceScenarioResult,
} from "./database";

/**
 * Standard workspace with owner and basic setup
 * Perfect for most E2E tests
 */
export async function createStandardWorkspaceScenario(): Promise<TestWorkspaceScenarioResult> {
  return createTestWorkspaceScenario({
    owner: {
      name: "E2E Test Owner",
      email: "e2e-owner@example.com",
      withGitHubAuth: true,
      githubUsername: "e2e-test-owner",
    },
    workspace: {
      name: "E2E Test Workspace",
      slug: `e2e-test-${Date.now()}`,
      description: "Workspace for E2E testing",
    },
  });
}

/**
 * Workspace with tasks for testing task management
 */
export async function createWorkspaceWithTasksScenario() {
  const scenario = await createStandardWorkspaceScenario();

  // Create 3 test tasks
  const tasks = await Promise.all([
    createTestTask({
      title: "E2E Test Task 1",
      description: "First test task",
      workspaceId: scenario.workspace.id,
      createdById: scenario.owner.id,
      status: "active",
    }),
    createTestTask({
      title: "E2E Test Task 2",
      description: "Second test task",
      workspaceId: scenario.workspace.id,
      createdById: scenario.owner.id,
      status: "active",
    }),
    createTestTask({
      title: "E2E Test Task 3",
      description: "Third test task",
      workspaceId: scenario.workspace.id,
      createdById: scenario.owner.id,
      status: "completed",
    }),
  ]);

  return {
    ...scenario,
    tasks,
  };
}

/**
 * Workspace with multiple members for testing collaboration
 */
export async function createWorkspaceWithMembersScenario() {
  return createTestWorkspaceScenario({
    owner: {
      name: "E2E Test Owner",
      email: "e2e-owner@example.com",
      withGitHubAuth: true,
    },
    workspace: {
      name: "E2E Team Workspace",
      slug: `e2e-team-${Date.now()}`,
    },
    members: [
      { role: "ADMIN", withGitHubAuth: true, githubUsername: "e2e-admin" },
      { role: "DEVELOPER", withGitHubAuth: true, githubUsername: "e2e-dev" },
      { role: "VIEWER", withGitHubAuth: true, githubUsername: "e2e-viewer" },
    ],
  });
}
