/**
 * E2E Database Fixtures
 *
 * Re-exports database utilities from integration test support
 * for use in E2E tests.
 */

export {
  resetDatabase,
  cleanup,
  deleteWorkspace,
  deleteWorkspaces,
  deleteUser,
  deleteUsers,
} from "@/__tests__/support/utilities/database";

export {
  createJanitorConfig,
  createJanitorRun,
  createJanitorRecommendation,
  createScreenshot,
} from "@/__tests__/support/factories/janitor.factory";

export {
  createTestUser,
  createTestUsers,
  type CreateTestUserOptions,
} from "@/__tests__/support/factories/user.factory";

export {
  createTestWorkspace,
  createTestMembership,
  createTestWorkspaceScenario,
  type CreateTestWorkspaceOptions,
  type CreateTestMembershipOptions,
  type CreateTestWorkspaceScenarioOptions,
  type TestWorkspaceScenarioResult,
  type WorkspaceMemberBlueprint,
} from "@/__tests__/support/factories/workspace.factory";

export {
  createTestTask,
  createTestChatMessage,
  createTestTaskWithMessages,
  type CreateTestTaskOptions,
  type CreateTestChatMessageOptions,
} from "@/__tests__/support/factories/task.factory";
