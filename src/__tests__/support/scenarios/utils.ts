/**
 * SCENARIOS Layer - Utility Functions
 * 
 * Provides schema versioning and safe database operations for scenarios.
 */

import { config } from "@/config/env";
import { resetDatabase } from "@/__tests__/support/fixtures/database";

/**
 * Current schema version for scenario compatibility tracking
 * Format: Semantic versioning (MAJOR.MINOR.PATCH)
 */
export const SCHEMA_VERSION = "1.0.0";

/**
 * Validate schema version compatibility
 */
export function validateSchemaVersion(version: string): boolean {
  return version === SCHEMA_VERSION;
}

/**
 * Mock mode guard - throws error if not in mock mode
 * Used to prevent accidental execution of test utilities in production
 */
export function mockModeGuard(): void {
  if (!config.USE_MOCKS) {
    throw new Error(
      "Scenario operations are only available in mock mode (USE_MOCKS=true). " +
      "This is a safety guard to prevent accidental test data manipulation in production."
    );
  }
}

/**
 * Safe database reset - only executes in mock mode
 * Wraps existing resetDatabase() utility with USE_MOCKS guard
 * 
 * @throws Error if USE_MOCKS is not true
 */
export async function safeResetDatabase(): Promise<void> {
  // Critical safety check - prevent production database reset
  mockModeGuard();

  // Use existing resetDatabase utility from fixtures
  await resetDatabase();
}

/**
 * Format scenario execution error for consistent error handling
 */
export function formatScenarioError(scenarioName: string, error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `Scenario execution failed for '${scenarioName}': ${errorMessage}`;
}

/**
 * Create scenario metadata with defaults
 */
export function createScenarioMetadata(
  overrides: Partial<ScenarioMetadata> = {}
): ScenarioMetadata {
  return {
    version: "1.0.0",
    schemaVersion: SCHEMA_VERSION,
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * ScenarioMetadata type for metadata creation
 */
interface ScenarioMetadata {
  version: string;
  schemaVersion: string;
  tags: string[];
  createdAt: Date;
  author?: string;
  description?: string;
}
