/**
 * Simple Mock User Scenario
 * 
 * Creates single test user (dev-user@mock.dev) for basic authentication testing.
 * Aligns with existing mock auth provider for seamless E2E and manual testing.
 */

import type { Scenario, ScenarioResult } from "../types";
import { safeResetDatabase, createScenarioMetadata } from "../utils";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { USER_VALUES } from "@/__tests__/support/values";

async function execute(): Promise<ScenarioResult> {
  try {
    // Reset database first
    await safeResetDatabase();

    // Create mock auth user with idempotent flag
    const mockUser = await createTestUser({
      email: USER_VALUES.mockAuthUser.email,
      name: USER_VALUES.mockAuthUser.name,
      role: "USER",
      idempotent: true,
    });

    return {
      success: true,
      message: "Mock user created successfully",
      data: {
        userId: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create mock user",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const simpleMockUserScenario: Scenario = {
  id: "simple-mock-user",
  name: "simple-mock-user",
  description: "Create single test user (dev-user@mock.dev) for basic authentication",
  execute,
  metadata: createScenarioMetadata({
    tags: ["auth", "user", "basic", "mock"],
    description: "Creates mock auth user matching mock provider configuration",
    author: "Hive Team",
  }),
};
