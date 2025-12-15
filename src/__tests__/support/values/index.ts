/**
 * Values Layer - Central exports
 *
 * This layer contains all data pools and named values for test data generation.
 * When schema changes occur, update the relevant file in this directory.
 */

// User values
export {
  USER_VALUES,
  USER_POOLS,
  getRandomUser,
  getNamedUser,
  resetUserCounter,
  type UserValueKey,
  type UserValue,
} from "./users";

// Task values
export {
  TASK_VALUES,
  TASK_POOLS,
  getRandomTask,
  getNamedTask,
  resetTaskCounters,
  type TaskValueKey,
  type TaskValue,
  type TaskCategory,
} from "./tasks";

// Workspace values
export {
  WORKSPACE_VALUES,
  WORKSPACE_POOLS,
  getRandomWorkspace,
  getNamedWorkspace,
  resetWorkspaceCounter,
  type WorkspaceValueKey,
  type WorkspaceValue,
} from "./workspaces";

// Swarm values
export {
  SWARM_VALUES,
  SWARM_POOLS,
  getRandomSwarm,
  getNamedSwarm,
  resetSwarmCounter,
  type SwarmValueKey,
  type SwarmValue,
} from "./swarms";

/**
 * Reset all value counters - useful for test isolation
 * Call this in beforeEach to ensure consistent test data
 */
export function resetAllValueCounters() {
  const { resetUserCounter } = require("./users");
  const { resetTaskCounters } = require("./tasks");
  const { resetWorkspaceCounter } = require("./workspaces");
  const { resetSwarmCounter } = require("./swarms");

  resetUserCounter();
  resetTaskCounters();
  resetWorkspaceCounter();
  resetSwarmCounter();
}
