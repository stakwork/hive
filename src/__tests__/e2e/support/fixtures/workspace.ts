import { Page, expect } from "@playwright/test";
import { selectors } from "./selectors";

/**
 * Navigate to workspace settings page
 */
export async function navigateToSettings(page: Page): Promise<void> {
  const settingsButton = page.locator(selectors.navigation.settingsButton);
  await settingsButton.waitFor({ state: "visible" });
  await settingsButton.click();

  // Verify we've landed on the settings page
  const pageTitle = page.locator(selectors.pageTitle.settings);
  await expect(pageTitle).toBeVisible();
}

/**
 * Navigate to tasks page
 */
export async function navigateToTasks(page: Page, workspaceSlug: string): Promise<void> {
  await page.goto(`http://localhost:3000/w/${workspaceSlug}/tasks`);

  // Wait for tasks page to load
  const pageTitle = page.locator(selectors.pageTitle.tasks);
  await expect(pageTitle).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to insights page
 */
export async function navigateToInsights(page: Page, workspaceSlug: string): Promise<void> {
  await page.goto(`http://localhost:3000/w/${workspaceSlug}/insights`);

  // Wait for insights page to load
  const pageTitle = page.locator(selectors.pageTitle.insights);
  await expect(pageTitle).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to dashboard
 */
export async function navigateToDashboard(page: Page, workspaceSlug: string): Promise<void> {
  await page.goto(`http://localhost:3000/w/${workspaceSlug}`);

  // Wait for dashboard to load
  const pageTitle = page.locator(selectors.pageTitle.dashboard);
  await expect(pageTitle).toBeVisible({ timeout: 10000 });
}

/**
 * Create a new workspace via onboarding wizard
 */
export async function createWorkspaceViaWizard(page: Page, workspaceName: string): Promise<string> {
  // Assuming we're on the onboarding page
  await page.waitForURL(/\/onboarding\/workspace/, { timeout: 10000 });

  // Fill in workspace name
  const nameInput = page.locator('input[name="name"], input[placeholder*="workspace" i]').first();
  await nameInput.waitFor({ state: "visible" });
  await nameInput.fill(workspaceName);

  // Click next/create button
  const nextButton = page
    .locator('button:has-text("Next"), button:has-text("Create"), button:has-text("Continue")')
    .first();
  await nextButton.click();

  // Wait for workspace creation to complete
  await page.waitForURL(/\/w\/.*/, { timeout: 15000 });

  // Extract workspace slug from URL
  const url = page.url();
  const match = url.match(/\/w\/([^\/]+)/);
  if (!match) {
    throw new Error("Failed to extract workspace slug after creation");
  }

  return match[1];
}
