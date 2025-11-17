import { Page } from '@playwright/test';
import { timeoutFor, TIMEOUT_FOR, getTimeout, TIMEOUTS } from '../config/timeouts';

/**
 * Wait helper utilities with standardized timeouts
 * Use semantic timeout names instead of arbitrary numbers
 */

/**
 * Wait for element to be visible
 */
export async function waitForElement(
  page: Page,
  selector: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? timeoutFor('ELEMENT_VISIBLE');
  await page.locator(selector).waitFor({ state: 'visible', timeout });
}

/**
 * Wait for element to be hidden
 */
export async function waitForElementToHide(
  page: Page,
  selector: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? timeoutFor('ELEMENT_HIDDEN');
  await page.locator(selector).waitFor({ state: 'hidden', timeout });
}

/**
 * Wait for loading state to complete
 */
export async function waitForLoadingToComplete(page: Page): Promise<void> {
  const loader = page.locator('text=/Loading|Saving|Processing/i');
  const checkTimeout = getTimeout(TIMEOUTS.QUICK);
  const waitTimeout = timeoutFor('LOADING_SPINNER');

  const loaderVisible = await loader.isVisible({ timeout: checkTimeout }).catch(() => false);

  if (loaderVisible) {
    await loader.waitFor({ state: 'hidden', timeout: waitTimeout });
  }
}

/**
 * Wait for network idle
 */
export async function waitForNetworkIdle(page: Page, options: { timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? timeoutFor('NETWORK_IDLE');
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Safe wait - only waits if condition is met
 */
export async function safeWait(
  page: Page,
  selector: string,
  options: { timeout?: number } = {}
): Promise<boolean> {
  const timeout = options.timeout ?? timeoutFor('ELEMENT_VISIBLE');
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait with polling for dynamic content
 */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? timeoutFor('API_RESPONSE');
  const interval = options.interval ?? 500;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms timeout`);
}
