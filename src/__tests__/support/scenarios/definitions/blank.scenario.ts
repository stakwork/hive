/**
 * Blank Scenario
 * 
 * Resets database to clean state without seeding any data.
 * Useful for tests that need a completely empty database.
 */

import type { Scenario, ScenarioResult } from "../types";
import { safeResetDatabase, createScenarioMetadata } from "../utils";

async function execute(): Promise<ScenarioResult> {
  try {
    // Reset database to clean state
    await safeResetDatabase();

    return {
      success: true,
      message: "Database reset complete. No data seeded.",
      data: {
        resettedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to reset database",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const blankScenario: Scenario = {
  id: "blank",
  name: "blank",
  description: "Reset database to clean state without seeding any data",
  execute,
  metadata: createScenarioMetadata({
    tags: ["cleanup", "empty", "reset"],
    description: "No-op scenario that only resets the database",
    author: "Hive Team",
  }),
};
