/**
 * Blank Scenario
 *
 * Resets the database to a clean state with no data.
 * Use this when you want to start completely fresh.
 */
import type { ScenarioDefinition, ScenarioResult } from "../types";
import { resetDatabase } from "../../utilities/database";

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
