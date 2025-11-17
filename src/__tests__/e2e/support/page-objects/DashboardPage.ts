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
    // First expand the Offense section if not already expanded
    const offenseButton = this.page.locator('[data-testid="nav-offense"]');
    const tasksLink = this.page.locator(selectors.navigation.tasksLink).first();

    // Check if tasks link is visible, if not, click Offense to expand
    const isTasksVisible = await tasksLink.isVisible();
    if (!isTasksVisible) {
      await offenseButton.click();
      await this.page.waitForTimeout(300); // Wait for expand animation
    }

    await tasksLink.click();
    await this.page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
  }

  /**
   * Navigate to roadmap page
   */
  async goToRoadmap(): Promise<void> {
    // First expand the Offense section if not already expanded
    const offenseButton = this.page.locator('[data-testid="nav-offense"]');
    const roadmapLink = this.page.locator(selectors.navigation.roadmapLink).first();

    // Check if roadmap link is visible, if not, click Offense to expand
    const isRoadmapVisible = await roadmapLink.isVisible();
    if (!isRoadmapVisible) {
      await offenseButton.click();
      await this.page.waitForTimeout(300); // Wait for expand animation
    }

    await roadmapLink.click();
    await this.page.waitForURL(/\/w\/.*\/roadmap/, { timeout: 10000 });
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

  /**
   * Open the workspace switcher dropdown
   */
  async openWorkspaceSwitcher(): Promise<void> {
    // Click the workspace switcher button to open the dropdown
    const switcherButton = this.page.locator(selectors.workspace.switcherButton);
    await switcherButton.click();
    
    // Wait for the dropdown menu to be visible
    await expect(this.page.locator('[role="menu"]')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify workspace switcher label shows correct count
   */
  async verifyWorkspaceSwitcherLabel(expectedText: string): Promise<void> {
    await expect(this.page.locator(selectors.workspace.switcherLabel)).toContainText(expectedText);
  }
}
