/**
 * Factories Layer - Central exports
 *
 * This layer contains all factory functions for creating test entities.
 * Factories pull data from the values layer and handle database operations.
 */

// User factory
export {
  createUser,
  createUsers,
  getOrCreateUser,
  type CreateUserOptions,
} from "./user.factory";

// Workspace factory
export {
  createWorkspace,
  createWorkspaces,
  createMembership,
  getOrCreateWorkspace,
  type CreateWorkspaceOptions,
  type CreateMembershipOptions,
} from "./workspace.factory";

// Task factory
export {
  createTask,
  createTasks,
  createChatMessage,
  createTaskWithMessages,
  createUserJourneyTask,
  createArtifact,
  type CreateTaskOptions,
  type CreateChatMessageOptions,
  type CreateUserJourneyTaskOptions,
  type CreateArtifactOptions,
} from "./task.factory";

// Swarm factory
export {
  createSwarm,
  createSwarms,
  createE2EReadySwarm,
  getOrCreateSwarm,
  type CreateSwarmOptions,
} from "./swarm.factory";

// Re-export values layer for convenience
export * from "../values";
