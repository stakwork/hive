import { Page, expect } from '@playwright/test';

/**
 * Assertion helper utilities
 * Common assertion patterns
 */

/**
 * Assert element is visible with custom timeout
 */
export async function assertVisible(
  page: Page,
  selector: string,
  timeout = 10000
): Promise<void> {
  await expect(page.locator(selector)).toBeVisible({ timeout });
}

/**
 * Assert element contains specific text
 */
export async function assertContainsText(
  page: Page,
  selector: string,
  text: string,
  timeout = 10000
): Promise<void> {
  await expect(page.locator(selector)).toContainText(text, { timeout });
}

/**
 * Assert element count matches expected
 */
export async function assertElementCount(
  page: Page,
  selector: string,
  expectedCount: number
): Promise<void> {
  const count = await page.locator(selector).count();
  expect(count).toBe(expectedCount);
}

/**
 * Assert URL matches pattern
 */
export function assertURLPattern(page: Page, pattern: RegExp): void {
  expect(page.url()).toMatch(pattern);
}

/**
 * Assert element exists (count > 0)
 */
export async function assertExists(page: Page, selector: string): Promise<void> {
  const count = await page.locator(selector).count();
  expect(count).toBeGreaterThan(0);
}

/**
 * Assert element does not exist
 */
export async function assertNotExists(page: Page, selector: string): Promise<void> {
  const count = await page.locator(selector).count();
  expect(count).toBe(0);
}
