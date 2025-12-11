/**
 * E2E Test Scenarios
 *
 * Pre-configured test scenarios for common E2E test setups.
 * These provide consistent, reproducible test data.
 */

import {
  createTestWorkspaceScenario,
  createTestTask,
  createTestUser,
  type CreateTestUserOptions,
  type TestWorkspaceScenarioResult,
} from "./database";

/**
 * Standard workspace with owner and basic setup
 * Perfect for most E2E tests
 *
 * IMPORTANT: Uses default mock auth user (dev-user@mock.dev) to align with
 * AuthPage.signInWithMock() which signs in as "dev-user" by default.
 */
export async function createStandardWorkspaceScenario(): Promise<TestWorkspaceScenarioResult> {
  return createTestWorkspaceScenario({
    owner: {
      name: "dev-user",
      email: "dev-user@mock.dev",
      withGitHubAuth: true,
      githubUsername: "dev-user",
    },
    workspace: {
      name: "E2E Test Workspace",
      slug: `e2e-test-${Date.now()}`,
      description: "Workspace for E2E testing",
    },
    withSwarm: true,
    swarm: {
      containerFilesSetUp: true,
      poolState: "COMPLETE",
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
      status: "IN_PROGRESS",
    }),
    createTestTask({
      title: "E2E Test Task 2",
      description: "Second test task",
      workspaceId: scenario.workspace.id,
      createdById: scenario.owner.id,
      status: "IN_PROGRESS",
    }),
    createTestTask({
      title: "E2E Test Task 3",
      description: "Third test task",
      workspaceId: scenario.workspace.id,
      createdById: scenario.owner.id,
      status: "DONE",
    }),
  ]);

  return {
    ...scenario,
    tasks,
  };
}

/**
 * Workspace with multiple members for testing collaboration
 *
 * IMPORTANT: Owner uses default mock auth user (dev-user@mock.dev) to align with
 * AuthPage.signInWithMock() which signs in as "dev-user" by default.
 */
export async function createWorkspaceWithMembersScenario() {
  return createTestWorkspaceScenario({
    owner: {
      name: "dev-user",
      email: "dev-user@mock.dev",
      withGitHubAuth: true,
      githubUsername: "dev-user",
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
    withSwarm: true,
    swarm: {
      containerFilesSetUp: true,
    },
  });
}

/**
 * Create a Hive user with GitHub auth for invitation flows.
 */
export async function createInvitableUser(options: Partial<CreateTestUserOptions> = {}) {
  return createTestUser({
    withGitHubAuth: true,
    ...options,
  });
}

/**
 * Workspace with recommendations for testing recommendation acceptance/dismissal
 *
 * IMPORTANT: Owner uses default mock auth user (dev-user@mock.dev) to align with
 * AuthPage.signInWithMock() which signs in as "dev-user" by default.
 */
export async function createWorkspaceWithRecommendationsScenario() {
  const { createJanitorConfig, createJanitorRun, createJanitorRecommendation } = await import("./database");
  
  const scenario = await createStandardWorkspaceScenario();

  // Create janitor config for the workspace
  const janitorConfig = await createJanitorConfig(scenario.workspace.id, {
    unitTestsEnabled: true,
    integrationTestsEnabled: true,
  });

  // Create a completed janitor run
  const janitorRun = await createJanitorRun(janitorConfig.id, {
    janitorType: "UNIT_TESTS",
    status: "COMPLETED",
  });

  // Create test recommendations
  const recommendations = await Promise.all([
    createJanitorRecommendation(scenario.workspace.id, {
      janitorRunId: janitorRun.id,
      title: "Add unit tests for UserService",
      description: "UserService lacks comprehensive test coverage. Adding tests will improve code reliability.",
      priority: "HIGH",
      impact: "Improves code reliability and catches bugs early",
      status: "PENDING",
    }),
    createJanitorRecommendation(scenario.workspace.id, {
      janitorRunId: janitorRun.id,
      title: "Add integration tests for API endpoints",
      description: "API endpoints need integration tests to verify end-to-end functionality.",
      priority: "MEDIUM",
      impact: "Ensures API contracts are maintained",
      status: "PENDING",
    }),
    createJanitorRecommendation(scenario.workspace.id, {
      janitorRunId: janitorRun.id,
      title: "Refactor authentication middleware",
      description: "Authentication middleware has code duplication that should be refactored.",
      priority: "LOW",
      impact: "Improves code maintainability",
      status: "PENDING",
    }),
  ]);

  return {
    ...scenario,
    janitorConfig,
    janitorRun,
    recommendations,
  };
}
