import { Page } from '@playwright/test';

/**
 * Navigation helper utilities
 * Common navigation patterns used across tests
 */

/**
 * Extract workspace slug from current URL
 */
export function extractWorkspaceSlug(page: Page): string {
  const url = page.url();
  const match = url.match(/\/w\/([^\/]+)/);
  if (!match) {
    throw new Error('Could not extract workspace slug from URL');
  }
  return match[1];
}

/**
 * Extract task ID from current URL
 */
export function extractTaskId(page: Page): string {
  const url = page.url();
  const match = url.match(/\/task\/([^\/]+)$/);
  if (!match) {
    throw new Error('Could not extract task ID from URL');
  }
  return match[1];
}

/**
 * Wait for navigation to complete
 */
export async function waitForNavigation(
  page: Page,
  urlPattern: RegExp,
  timeout = 10000
): Promise<void> {
  await page.waitForURL(urlPattern, { timeout });
}

/**
 * Navigate and wait for page load
 */
export async function navigateAndWait(
  page: Page,
  url: string,
  titleSelector: string,
  timeout = 10000
): Promise<void> {
  await page.goto(url);
  await page.locator(titleSelector).waitFor({ state: 'visible', timeout });
}
