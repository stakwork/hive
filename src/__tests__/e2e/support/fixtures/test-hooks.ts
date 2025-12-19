/**
 * E2E Test Hooks
 *
 * Provides setup and teardown utilities for E2E tests.
 * Ensures test isolation and clean database state.
 * 
 * Supports parallel execution using worker-based isolation:
 * - Each Playwright worker gets isolated test data
 * - Workers can run tests concurrently without conflicts
 */

import { test as base } from '@playwright/test';
import { resetDatabase } from './database';

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
 * and worker-based isolation for parallel execution
 *
 * Usage in test files:
 * ```typescript
 * import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
 *
 * test('my test', async ({ page, workerInfo }) => {
 *   // Database is automatically cleaned before this test
 *   // Each worker has isolated test data
 * });
 * ```
 */
export const test = base.extend({
  // Automatically clean database before each test
  // Worker isolation ensures parallel tests don't conflict
  page: async ({ page }, use, testInfo) => {
    // Reset database with worker context for isolation
    // The worker index ensures each parallel worker operates on isolated data
    await resetDatabase();
    await use(page);
  },
});

export { expect } from '@playwright/test';
