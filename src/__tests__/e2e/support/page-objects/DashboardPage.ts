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
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.dashboard)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page description is visible
   */
  async verifyDescription(): Promise<void> {
    await expect(this.page.locator('text=Welcome to your development workspace')).toBeVisible();
  }

  /**
   * Check if VM config section is present
   */
  async hasVMConfigSection(): Promise<boolean> {
    const section = this.page.locator(selectors.dashboard.vmSection);
    return (await section.count()) > 0;
  }

  /**
   * Check if repository section is present
   */
  async hasRepositorySection(): Promise<boolean> {
    const section = this.page.locator(selectors.dashboard.repoSection);
    return (await section.count()) > 0;
  }

  /**
   * Check if test coverage section is present
   */
  async hasCoverageSection(): Promise<boolean> {
    try {
      const section = this.page.locator(selectors.dashboard.coverageSection);
      await section.waitFor({ state: 'visible', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if recent tasks section is present
   */
  async hasRecentTasksSection(): Promise<boolean> {
    const section = this.page.locator(selectors.dashboard.recentTasksSection).first();
    return await section.count() > 0;
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
   * Verify workspace switcher is visible
   */
  async verifyWorkspaceSwitcher(): Promise<void> {
    const switcher = this.page.locator('button').filter({ hasText: /mock/i }).first();
    await expect(switcher).toBeVisible();
  }

  /**
   * Reload the page
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }
}
