/**
 * SCENARIOS Layer - Scenario Registry
 * 
 * Centralized registry for scenario management, discovery, and execution.
 * Implements singleton pattern for shared state across application.
 */

import type { Scenario, ScenarioResult, IScenarioRegistry } from "./types";
import { validateSchemaVersion, formatScenarioError, mockModeGuard } from "./utils";

/**
 * Custom error for scenario not found
 */
export class ScenarioNotFoundError extends Error {
  constructor(scenarioName: string) {
    super(`Scenario not found: ${scenarioName}`);
    this.name = "ScenarioNotFoundError";
  }
}

/**
 * Custom error for invalid schema version
 */
export class InvalidSchemaVersionError extends Error {
  constructor(scenarioId: string, version: string, expected: string) {
    super(
      `Invalid schema version for scenario '${scenarioId}': got ${version}, expected ${expected}`
    );
    this.name = "InvalidSchemaVersionError";
  }
}

/**
 * Scenario Registry - Singleton
 * 
 * Manages scenario registration, listing, and execution with schema validation.
 */
export class ScenarioRegistry implements IScenarioRegistry {
  private static instance: ScenarioRegistry;
  private scenarios: Map<string, Scenario>;

  private constructor() {
    this.scenarios = new Map();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ScenarioRegistry {
    if (!ScenarioRegistry.instance) {
      ScenarioRegistry.instance = new ScenarioRegistry();
    }
    return ScenarioRegistry.instance;
  }

  /**
   * Register a scenario in the registry
   * 
   * @throws InvalidSchemaVersionError if schema version doesn't match
   * @throws Error if scenario with same name already registered
   */
  public register(scenario: Scenario): void {
    // Validate schema version
    if (!validateSchemaVersion(scenario.metadata.schemaVersion)) {
      throw new InvalidSchemaVersionError(
        scenario.id,
        scenario.metadata.schemaVersion,
        scenario.metadata.schemaVersion
      );
    }

    // Check for duplicate registration
    if (this.scenarios.has(scenario.name)) {
      throw new Error(`Scenario already registered: ${scenario.name}`);
    }

    this.scenarios.set(scenario.name, scenario);
  }

  /**
   * List all registered scenarios
   * 
   * @returns Array of all registered scenarios sorted by name
   */
  public list(): Scenario[] {
    return Array.from(this.scenarios.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Execute a scenario by name
   * 
   * @throws ScenarioNotFoundError if scenario doesn't exist
   * @throws Error if not in mock mode (via mockModeGuard)
   */
  public async execute(name: string): Promise<ScenarioResult> {
    // Safety guard - only allow execution in mock mode
    mockModeGuard();

    const scenario = this.scenarios.get(name);
    if (!scenario) {
      throw new ScenarioNotFoundError(name);
    }

    try {
      const result = await scenario.execute();
      return result;
    } catch (error) {
      return {
        success: false,
        message: "Scenario execution failed",
        error: formatScenarioError(name, error),
      };
    }
  }

  /**
   * Get scenarios by tag
   * 
   * @returns Array of scenarios containing the specified tag
   */
  public getByTag(tag: string): Scenario[] {
    return Array.from(this.scenarios.values())
      .filter((scenario) => scenario.metadata.tags.includes(tag))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get scenario by name (for testing/debugging)
   */
  public get(name: string): Scenario | undefined {
    return this.scenarios.get(name);
  }

  /**
   * Clear all registered scenarios (for testing)
   */
  public clear(): void {
    this.scenarios.clear();
  }
}
