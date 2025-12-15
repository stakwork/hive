/**
 * Scenarios Layer - Central registry and exports
 *
 * This layer provides named entry points to test data scenarios.
 * Scenarios compose factories and values to create complete test environments.
 */
import type {
  ScenarioDefinition,
  ScenarioResult,
  ScenarioInfo,
  ListScenariosResponse,
  RunScenarioResponse,
} from "./types";
import { getSchemaVersion } from "./schema-version";

// Import scenario definitions
import { blankScenario } from "./definitions/blank";
import { simpleMockUserScenario } from "./definitions/simple-mock-user";

/**
 * Registry of all available scenarios
 *
 * Only includes scenarios used for development/testing:
 * - blank: Clean database, no data
 * - simple_mock_user: Mock user with workspace, repository, and swarm
 */
const SCENARIO_REGISTRY: Record<string, ScenarioDefinition> = {
  blank: blankScenario,
  simple_mock_user: simpleMockUserScenario,
};

/**
 * Register a new scenario (useful for tests adding custom scenarios)
 */
export function registerScenario(scenario: ScenarioDefinition): void {
  SCENARIO_REGISTRY[scenario.name] = scenario;
}

/**
 * Get a scenario definition by name
 */
export function getScenario(name: string): ScenarioDefinition | undefined {
  return SCENARIO_REGISTRY[name];
}

/**
 * List all available scenarios
 */
export function listScenarios(): ScenarioInfo[] {
  return Object.values(SCENARIO_REGISTRY).map((s) => ({
    name: s.name,
    description: s.description,
    extends: s.extends,
    tags: s.tags,
  }));
}

/**
 * List scenarios for API response
 */
export async function listScenariosForAPI(): Promise<ListScenariosResponse> {
  return {
    schemaVersion: await getSchemaVersion(),
    scenarios: listScenarios(),
  };
}

/**
 * Run a scenario by name
 *
 * If the scenario extends another, the parent is run first.
 * Results are passed down the chain.
 *
 * @example
 * const result = await runScenario("workspace_with_tasks");
 * // result.data.workspace, result.data.owner, result.data.tasks
 */
export async function runScenario(name: string): Promise<ScenarioResult> {
  const scenario = SCENARIO_REGISTRY[name];
  if (!scenario) {
    const available = Object.keys(SCENARIO_REGISTRY).join(", ");
    throw new Error(`Unknown scenario: "${name}". Available: ${available}`);
  }

  // If extends another scenario, run parent first
  let parentResult: ScenarioResult | undefined;
  if (scenario.extends) {
    parentResult = await runScenario(scenario.extends);
  }

  return scenario.run(parentResult);
}

/**
 * Run a scenario and format for API response
 */
export async function runScenarioForAPI(name: string): Promise<RunScenarioResponse> {
  const result = await runScenario(name);

  return {
    success: true,
    scenario: result.metadata,
    data: {
      workspaceId: result.data.workspace?.id || "",
      workspaceSlug: result.data.workspace?.slug || "",
      ownerId: result.data.owner?.id || "",
      ownerEmail: result.data.owner?.email || "",
      memberCount: result.data.members?.length || 0,
      taskCount: result.data.tasks?.length || 0,
      hasSwarm: !!result.data.swarm,
      hasRepository: !!result.data.repository,
    },
  };
}

// Re-export types
export type {
  ScenarioDefinition,
  ScenarioResult,
  ScenarioInfo,
  ScenarioMetadata,
  ScenarioData,
  ListScenariosResponse,
  RunScenarioResponse,
} from "./types";

// Re-export schema version utilities
export { getSchemaVersion, validateSchemaVersion, schemaVersionMatches } from "./schema-version";
