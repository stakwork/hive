import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Dashboard page
 * Encapsulates all dashboard interactions and assertions
 */
export class DashboardPage {
  constructor(private page: Page) {}

  /**
   * Navigate to dashboard for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}`);
    await this.waitForLoad();
  }

  /**
   * Wait for dashboard to fully load
   * Dashboard no longer has a title, so we wait for the graph component to be visible
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });
  }

  /**
   * Navigate to tasks page
   */
  async goToTasks(): Promise<void> {
    // First expand the Build section if not already expanded
    const buildButton = this.page.locator(selectors.navigation.buildButton);
    const tasksLink = this.page.locator(selectors.navigation.tasksLink).first();

    // Check if tasks link is visible, if not, click Build to expand
    const isTasksVisible = await tasksLink.isVisible().catch(() => false);
    if (!isTasksVisible) {
      await buildButton.click();
      await tasksLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await tasksLink.click();
    await this.page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
  }

  /**
   * Navigate to plan page
   */
  async goToRoadmap(): Promise<void> {
    // First expand the Build section if not already expanded
    const buildButton = this.page.locator(selectors.navigation.buildButton);
    const planLink = this.page.locator(selectors.navigation.roadmapLink).first();

    // Check if plan link is visible, if not, click Build to expand
    const isPlanVisible = await planLink.isVisible().catch(() => false);
    if (!isPlanVisible) {
      await buildButton.click();
      await planLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await planLink.click();
    await this.page.waitForURL(/\/w\/.*\/plan/, { timeout: 10000 });
  }

  /**
   * Navigate to recommendations page
   */
  async goToRecommendations(): Promise<void> {
    // First expand the Protect section if not already expanded
    const protectButton = this.page.locator(selectors.navigation.protectButton);
    const recommendationsLink = this.page.locator(selectors.navigation.recommendationsLink).first();

    // Check if recommendations link is visible, if not, click Protect to expand
    const isRecommendationsVisible = await recommendationsLink.isVisible().catch(() => false);
    if (!isRecommendationsVisible) {
      await protectButton.click();
      await recommendationsLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await recommendationsLink.click();
    await this.page.waitForURL(/\/w\/.*\/recommendations/, { timeout: 10000 });
  }

  /**
   * Navigate to janitors page
   */
  async goToJanitors(): Promise<void> {
    // First expand the Protect section if not already expanded
    const protectButton = this.page.locator(selectors.navigation.protectButton);
    const janitorsLink = this.page.locator(selectors.navigation.janitorsLink).first();

    // Check if janitors link is visible, if not, click Protect to expand
    const isJanitorsVisible = await janitorsLink.isVisible().catch(() => false);
    if (!isJanitorsVisible) {
      await protectButton.click();
      await janitorsLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await janitorsLink.click();
    await this.page.waitForURL(/\/w\/.*\/janitors/, { timeout: 10000 });
  }

  /**
   * Navigate to settings page
   */
  async goToSettings(): Promise<void> {
    // Wait for the button to be ready and click it
    const settingsButton = this.page.locator(selectors.navigation.settingsButton);
    await settingsButton.waitFor({ state: 'visible', timeout: 5000 });
    
    // Use Promise.all to handle navigation that starts on click
    await Promise.all([
      this.page.waitForURL(/\/w\/.*\/settings/, { timeout: 15000 }),
      settingsButton.click()
    ]);
    
    await expect(this.page.locator(selectors.pageTitle.settings)).toBeVisible();
  }

  /**
   * Navigate to capacity page
   */
  async goToCapacity(): Promise<void> {
    const capacityLink = this.page.locator(selectors.navigation.capacityLink);
    await capacityLink.waitFor({ state: 'visible', timeout: 5000 });
    
    // Use Promise.all to handle navigation that starts on click
    await Promise.all([
      this.page.waitForURL(/\/w\/.*\/capacity/, { timeout: 30000 }),
      capacityLink.click()
    ]);
  }

  /**
   * Reload the page
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }

  /**
   * Check if dashboard is loaded (graph is visible)
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator('[data-testid="graph-component"]').isVisible();
  }
}
