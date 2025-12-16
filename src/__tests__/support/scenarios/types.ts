/**
 * Scenario Types - Type definitions for the scenario system
 */
import type { User, Workspace, Swarm, Task, WorkspaceMember } from "@prisma/client";

/**
 * Metadata about a scenario execution
 */
export interface ScenarioMetadata {
  name: string;
  description: string;
  extends?: string;
  tags?: string[];
  executedAt: string;
}

/**
 * Result of running a scenario
 */
export interface ScenarioResult {
  metadata: ScenarioMetadata;
  data: ScenarioData;
}

/**
 * Data created by a scenario
 */
export interface ScenarioData {
  // Core entities (may be null for "blank" scenario)
  owner: User | null;
  workspace: Workspace | null;
  // Optional entities
  swarm?: Swarm | null;
  members?: User[];
  memberships?: WorkspaceMember[];
  tasks?: Task[];
  repository?: { id: string; name: string; repositoryUrl: string; branch: string; status: string } | null;
  // Extensible for custom data
  [key: string]: unknown;
}

/**
 * Function signature for scenario execution
 */
export type ScenarioFn = (parent?: ScenarioResult) => Promise<ScenarioResult>;

/**
 * Definition of a scenario
 */
export interface ScenarioDefinition {
  /** Unique name for the scenario (e.g., "happy_path") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Name of parent scenario to extend (runs parent first) */
  extends?: string;
  /** Tags for filtering/categorization */
  tags?: string[];
  /** The function that creates the scenario data */
  run: ScenarioFn;
}

/**
 * Scenario info returned by the list API
 */
export interface ScenarioInfo {
  name: string;
  description: string;
  extends?: string;
  tags?: string[];
}

/**
 * API response for listing scenarios
 */
export interface ListScenariosResponse {
  scenarios: ScenarioInfo[];
}

/**
 * API response for running a scenario
 */
export interface RunScenarioResponse {
  success: boolean;
  scenario: ScenarioMetadata;
  data: {
    workspaceId: string;
    workspaceSlug: string;
    ownerId: string;
    ownerEmail: string;
    memberCount?: number;
    taskCount?: number;
    hasSwarm: boolean;
    [key: string]: unknown;
  };
}
