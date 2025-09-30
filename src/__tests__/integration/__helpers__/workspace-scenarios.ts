import { createTestWorkspaceScenario } from "@/__tests__/fixtures/workspace";
import { createTestUser } from "@/__tests__/fixtures/user";

/**
 * Creates a workspace with owner, admin, and developer members
 * Common scenario for testing workspace operations with different permission levels
 */
export async function createWorkspaceWithMultipleRoles() {
  const scenario = await createTestWorkspaceScenario({
    workspace: {
      description: "Test workspace",
    },
    members: [
      { role: "ADMIN" },
      { role: "DEVELOPER" },
    ],
  });

  return {
    ownerUser: scenario.owner,
    adminUser: scenario.members[0],
    memberUser: scenario.members[1],
    workspace: scenario.workspace,
  };
}

/**
 * Creates a workspace with GitHub-enabled members
 * Used for testing member operations that require GitHub authentication
 */
export async function createWorkspaceWithGitHubMembers() {
  const scenario = await createTestWorkspaceScenario({
    members: [
      { role: "DEVELOPER", withGitHubAuth: true, githubUsername: "testuser" },
    ],
  });

  const targetUser = await createTestUser({
    name: "Target User",
    withGitHubAuth: true,
    githubUsername: "targetuser",
  });

  return {
    ownerUser: scenario.owner,
    workspace: scenario.workspace,
    memberUser: scenario.members[0],
    targetUser,
  };
}