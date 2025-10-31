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
    await this.page.locator(selectors.navigation.tasksLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
  }

  /**
   * Navigate to insights page
   */
  async goToInsights(): Promise<void> {
    await this.page.locator(selectors.navigation.insightsLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/insights/, { timeout: 10000 });
  }

  /**
   * Navigate to settings page
   */
  async goToSettings(): Promise<void> {
    await this.page.locator(selectors.navigation.settingsButton).click();
    await expect(this.page.locator(selectors.pageTitle.settings)).toBeVisible();
  }

  /**
   * Navigate to roadmap page
   */
  async goToRoadmap(): Promise<void> {
    await this.page.locator(selectors.navigation.roadmapLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/roadmap/, { timeout: 10000 });
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
