/**
 * E2E Test Hooks
 *
 * Provides setup and teardown utilities for E2E tests.
 * Ensures test isolation and clean database state with per-worker schema isolation.
 */

import { test as base } from '@playwright/test';
import { resetDatabaseWithUrl } from './database';

/**
 * Strip existing ?schema= parameter from DATABASE_URL
 */
function stripSchema(url: string): string {
  return url.split('?')[0];
}

/**
 * Test lifecycle hook for database cleanup
 * Use in test files with test.beforeEach()
 */
export async function setupTest(): Promise<void> {
  // Clean database before each test for isolation
  const baseUrl = stripSchema(process.env.DATABASE_URL!);
  const schemaUrl = `${baseUrl}?schema=test_worker_0`;
  await resetDatabaseWithUrl(schemaUrl);
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
 * Extended Playwright test with automatic database cleanup per worker
 *
 * Each parallel worker gets its own isolated Postgres schema (test_worker_0, test_worker_1, etc.)
 * to prevent data collisions during parallel test execution.
 *
 * Usage in test files:
 * ```typescript
 * import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
 *
 * test('my test', async ({ page }) => {
 *   // Database is automatically cleaned before this test in worker-specific schema
 * });
 * ```
 */
export const test = base.extend<{}, { workerStorageState: string }>({
  // Worker-scoped fixture that sets DATABASE_URL once per worker
  workerStorageState: [
    async ({}, use, workerInfo) => {
      const baseUrl = stripSchema(process.env.DATABASE_URL!);
      const schemaUrl = `${baseUrl}?schema=test_worker_${workerInfo.workerIndex}`;
      
      // Store original and set worker-specific URL
      const originalUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = schemaUrl;
      
      // Clear cached Prisma client so it reconnects with new URL
      const globalForPrisma = globalThis as unknown as { prisma?: any };
      if (globalForPrisma.prisma) {
        await globalForPrisma.prisma.$disconnect();
        delete globalForPrisma.prisma;
      }

      await use('');

      // Restore and reconnect
      process.env.DATABASE_URL = originalUrl;
      if (globalForPrisma.prisma) {
        await globalForPrisma.prisma.$disconnect();
        delete globalForPrisma.prisma;
      }
    },
    { scope: 'worker' }
  ],

  // Test-scoped fixture that resets the database before each test
  page: async ({ page, workerStorageState }, use, testInfo) => {
    // DATABASE_URL is already set to worker-specific schema by workerStorageState
    const baseUrl = stripSchema(process.env.DATABASE_URL!);
    const schemaUrl = `${baseUrl}?schema=test_worker_${testInfo.parallelIndex}`;
    
    await resetDatabaseWithUrl(schemaUrl);
    await use(page);
  },
});

export { expect } from '@playwright/test';
