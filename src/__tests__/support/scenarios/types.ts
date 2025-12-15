/**
 * SCENARIOS Layer - Type Definitions
 * 
 * Defines core interfaces for the Three-Tier Test Data Scenario System.
 */

/**
 * Scenario execution result
 */
export interface ScenarioResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
  error?: string;
}

/**
 * Scenario metadata for discovery and versioning
 */
export interface ScenarioMetadata {
  version: string;
  schemaVersion: string;
  tags: string[];
  createdAt: Date;
  author?: string;
  description?: string;
}

/**
 * Scenario definition
 */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  execute: () => Promise<ScenarioResult>;
  metadata: ScenarioMetadata;
}

/**
 * Scenario registry interface for management operations
 */
export interface IScenarioRegistry {
  register(scenario: Scenario): void;
  list(): Scenario[];
  execute(name: string): Promise<ScenarioResult>;
  getByTag(tag: string): Scenario[];
}
