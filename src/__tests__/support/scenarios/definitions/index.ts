/**
 * Scenario Definitions - Central Exports
 * 
 * Exports all scenario definitions for automatic registration in the scenario registry.
 */

import { blankScenario } from "./blank.scenario";
import { simpleMockUserScenario } from "./simple-mock-user.scenario";
import { multiUserWorkspaceScenario } from "./multi-user-workspace.scenario";

export const scenarios = [
  blankScenario,
  simpleMockUserScenario,
  multiUserWorkspaceScenario,
];

export { blankScenario, simpleMockUserScenario, multiUserWorkspaceScenario };
