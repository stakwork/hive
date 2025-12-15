/**
 * SCENARIOS Layer - Central Exports
 * 
 * Provides scenario management infrastructure for the Three-Tier Test Data System.
 * Auto-registers all scenario definitions on module load.
 */

// Export types
export type { Scenario, ScenarioResult, ScenarioMetadata, IScenarioRegistry } from "./types";

// Export utilities
export {
  SCHEMA_VERSION,
  validateSchemaVersion,
  mockModeGuard,
  safeResetDatabase,
  formatScenarioError,
  createScenarioMetadata,
} from "./utils";

// Export registry and errors
export {
  ScenarioRegistry,
  ScenarioNotFoundError,
  InvalidSchemaVersionError,
} from "./registry";

// Export scenario definitions
export { scenarios, blankScenario, simpleMockUserScenario, multiUserWorkspaceScenario } from "./definitions";

// Initialize registry instance
import { ScenarioRegistry } from "./registry";
import { scenarios } from "./definitions";

export const scenarioRegistry = ScenarioRegistry.getInstance();

// Auto-register all scenarios on module load
scenarios.forEach((scenario) => {
  scenarioRegistry.register(scenario);
});
