/**
 * E2E Test Hooks
 *
 * Provides setup and teardown utilities for E2E tests.
 * Ensures test isolation and clean database state.
 * 
 * Uses file-system locking to coordinate database resets across workers
 * to prevent race conditions during parallel test execution.
 */

import { test as base } from '@playwright/test';
import { resetDatabase } from './database';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Lock file to coordinate database resets across workers
const LOCK_FILE = path.join(os.tmpdir(), 'playwright-db-reset.lock');
const MAX_LOCK_WAIT = 30000; // 30 seconds

/**
 * Acquire lock with timeout to prevent deadlocks
 */
async function acquireLock(workerId: number): Promise<void> {
  const startTime = Date.now();
  const lockContent = `worker-${workerId}-${Date.now()}`;
  
  while (Date.now() - startTime < MAX_LOCK_WAIT) {
    try {
      // Try to create lock file exclusively
      fs.writeFileSync(LOCK_FILE, lockContent, { flag: 'wx' });
      return; // Lock acquired
    } catch (err) {
      // Lock exists, wait and retry
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  throw new Error(`Failed to acquire database reset lock after ${MAX_LOCK_WAIT}ms`);
}

/**
 * Release lock
 */
function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    // Lock file may not exist, ignore
  }
}

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
 * and synchronized database resets for parallel execution
 *
 * Usage in test files:
 * ```typescript
 * import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
 *
 * test('my test', async ({ page }) => {
 *   // Database is automatically cleaned before this test
 *   // Synchronized across all parallel workers
 * });
 * ```
 */
export const test = base.extend({
  // Automatically clean database before each test with proper locking
  page: async ({ page }, use, testInfo) => {
    const workerId = testInfo.parallelIndex;
    
    // Acquire lock to ensure only one worker resets DB at a time
    await acquireLock(workerId);
    
    try {
      // Reset database with exclusive access
      await resetDatabase();
    } finally {
      // Always release lock, even if reset fails
      releaseLock();
    }
    
    await use(page);
  },
});

export { expect } from '@playwright/test';
