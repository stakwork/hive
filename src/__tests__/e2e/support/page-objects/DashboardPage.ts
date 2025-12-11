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
    await expect(this.page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to tasks page
   */
  async goToTasks(): Promise<void> {
    // First expand the Build section if not already expanded
    const buildButton = this.page.locator('[data-testid="nav-build"]');
    const tasksLink = this.page.locator(selectors.navigation.tasksLink).first();

    // Check if tasks link is visible, if not, click Build to expand
    const isTasksVisible = await tasksLink.isVisible();
    if (!isTasksVisible) {
      await buildButton.click();
      await this.page.waitForTimeout(300); // Wait for expand animation
    }

    await tasksLink.click();
    await this.page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
  }

  /**
   * Navigate to plan page
   */
  async goToRoadmap(): Promise<void> {
    // First expand the Build section if not already expanded
    const buildButton = this.page.locator('[data-testid="nav-build"]');
    const planLink = this.page.locator(selectors.navigation.roadmapLink).first();

    // Check if plan link is visible, if not, click Build to expand
    const isPlanVisible = await planLink.isVisible();
    if (!isPlanVisible) {
      await buildButton.click();
      await this.page.waitForTimeout(300); // Wait for expand animation
    }

    await planLink.click();
    await this.page.waitForURL(/\/w\/.*\/plan/, { timeout: 10000 });
  }

  /**
   * Navigate to recommendations page
   */
  async goToRecommendations(): Promise<void> {
    // First expand the Protect section if not already expanded
    const protectButton = this.page.locator('[data-testid="nav-protect"]');
    const recommendationsLink = this.page.locator(selectors.navigation.recommendationsLink).first();

    // Wait for protect button to be visible (ensures nav is loaded)
    await protectButton.waitFor({ state: 'visible', timeout: 10000 });

    // Check if recommendations link is visible, if not, click Protect to expand
    const isRecommendationsVisible = await recommendationsLink.isVisible();
    if (!isRecommendationsVisible) {
      await protectButton.click();
      await this.page.waitForTimeout(300); // Wait for expand animation
    }

    await recommendationsLink.click();
    await this.page.waitForURL(/\/w\/.*\/recommendations/, { timeout: 10000 });
  }

  /**
   * Navigate to settings page
   */
  async goToSettings(): Promise<void> {
    await this.page.locator(selectors.navigation.settingsButton).click();
    await this.page.waitForURL(/\/w\/.*\/settings/, { timeout: 10000 });
    await expect(this.page.locator(selectors.pageTitle.settings)).toBeVisible();
  }

  /**
   * Navigate to capacity page
   */
  async goToCapacity(): Promise<void> {
    await this.page.locator(selectors.navigation.capacityLink).click();
    await this.page.waitForURL(/\/w\/.*\/capacity/, { timeout: 10000 });
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
