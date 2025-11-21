/**
 * E2E Test Hooks
 *
 * Provides setup and teardown utilities for E2E tests.
 * Ensures test isolation and clean database state.
 */

import { test as base } from "@playwright/test";
import { resetDatabase } from "./database";

/**
 * Test lifecycle hook for database cleanup
 * Use in test files with test.beforeEach()
 */
export async function setupTest(): Promise<void> {
  // Clean database before each test for isolation
  await resetDatabase();
}

/**
 * Test lifecycle hook for database cleanup after tests
 * Use in test files with test.afterAll()
 */
export async function teardownTest(): Promise<void> {
  // Optional: Clean up after all tests
  // Usually not needed as beforeEach handles cleanup
}

/**
 * Extended Playwright test with automatic database cleanup
 *
 * Usage in test files:
 * ```typescript
 * import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
 *
 * test('my test', async ({ page }) => {
 *   // Database is automatically cleaned before this test
 * });
 * ```
 */
export const test = base.extend({
  // Automatically clean database before each test
  page: async ({ page }, use) => {
    await resetDatabase();
    await use(page);
  },
});

export { expect } from "@playwright/test";
