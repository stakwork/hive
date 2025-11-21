import { Page } from "@playwright/test";

/**
 * Wait helper utilities
 * Common wait patterns to avoid arbitrary timeouts
 */

/**
 * Wait for element to be visible
 */
export async function waitForElement(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.locator(selector).waitFor({ state: "visible", timeout });
}

/**
 * Wait for element to be hidden
 */
export async function waitForElementToHide(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.locator(selector).waitFor({ state: "hidden", timeout });
}

/**
 * Wait for loading state to complete
 */
export async function waitForLoadingToComplete(page: Page): Promise<void> {
  const loader = page.locator("text=/Loading|Saving|Processing/i");
  const loaderVisible = await loader.isVisible({ timeout: 1000 }).catch(() => false);

  if (loaderVisible) {
    await loader.waitFor({ state: "hidden", timeout: 30000 });
  }
}

/**
 * Wait for network idle
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout });
}

/**
 * Safe wait - only waits if condition is met
 */
export async function safeWait(page: Page, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.locator(selector).waitFor({ state: "visible", timeout });
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
  timeout = 10000,
  interval = 500,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("Condition not met within timeout");
}
