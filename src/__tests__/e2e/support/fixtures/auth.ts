import { Page, expect } from "@playwright/test";

/**
 * Shared authentication fixture for E2E tests
 * Handles mock sign-in flow used across multiple test suites
 */
export async function mockSignIn(page: Page): Promise<void> {
  await page.goto("http://localhost:3000");

  const signInButton = page.locator('[data-testid="mock-signin-button"]');
  await signInButton.waitFor({ state: "visible", timeout: 10000 });
  await signInButton.click();

  // Wait for authentication to complete by checking for navigation
  await page.waitForURL(/\/w\/.*/, { timeout: 10000 });
}

/**
 * Verify user is authenticated by checking for workspace UI elements
 */
export async function verifyAuthenticated(page: Page): Promise<void> {
  // Wait for workspace sidebar or settings button to be visible
  const settingsButton = page.locator('button:has-text("Settings")');
  await expect(settingsButton).toBeVisible({ timeout: 10000 });
}

/**
 * Get the current workspace slug from the URL
 */
export function getCurrentWorkspaceSlug(page: Page): string {
  const url = page.url();
  const match = url.match(/\/w\/([^\/]+)/);
  if (!match) {
    throw new Error("Could not extract workspace slug from URL");
  }
  return match[1];
}
