/**
 * Blank Scenario
 *
 * Resets the database to a clean state with no data.
 * Use this when you want to start completely fresh.
 */
import type { ScenarioDefinition, ScenarioResult } from "../types";
import { getSchemaVersion } from "../schema-version";
import { resetDatabase } from "../../fixtures/database";

export const blankScenario: ScenarioDefinition = {
  name: "blank",
  description: "Clean database with no data - start fresh",
  tags: ["base"],

  run: async (): Promise<ScenarioResult> => {
    // Reset database to clean state
    await resetDatabase();

    return {
      metadata: {
        name: "blank",
        description: "Clean database with no data",
        schemaVersion: await getSchemaVersion(),
        tags: ["base"],
        executedAt: new Date().toISOString(),
      },
      data: {
        // No data created - null values indicate fresh start
        owner: null,
        workspace: null,
        swarm: null,
      },
    };
  },
};
