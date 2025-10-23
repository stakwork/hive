/**
 * E2E Test Scenarios
 *
 * Pre-configured test scenarios for common E2E test setups.
 * These provide consistent, reproducible test data.
 */

import { db } from "@/lib/db";
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
 * Workspace with janitor configuration for testing janitor features
 * 
 * Creates a standard workspace with JanitorConfig initialized.
 * By default, all janitors are disabled (false).
 * Sets poolState to COMPLETE on the Swarm to allow janitor toggles to work.
 */
export async function createWorkspaceWithJanitorConfigScenario() {
  const scenario = await createStandardWorkspaceScenario();

  // Update swarm poolState to COMPLETE so janitor toggles work
  // (The JanitorSection checks workspace.poolState which comes from the swarm)
  if (scenario.swarm) {
    await db.swarm.update({
      where: { id: scenario.swarm.id },
      data: { poolState: "COMPLETE" },
    });
  }

  // Create JanitorConfig for the workspace
  const janitorConfig = await db.janitorConfig.create({
    data: {
      workspaceId: scenario.workspace.id,
      unitTestsEnabled: false,
      integrationTestsEnabled: false,
      e2eTestsEnabled: false,
      securityReviewEnabled: false,
      taskCoordinatorEnabled: false,
      recommendationSweepEnabled: false,
      ticketSweepEnabled: false,
    },
  });

  return {
    ...scenario,
    janitorConfig,
  };
}
