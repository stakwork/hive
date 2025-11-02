import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Insights page
 * Encapsulates all insights page interactions and assertions
 */
export class InsightsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to insights page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/insights`);
    await this.waitForLoad();
  }

  /**
   * Wait for insights page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.insights)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to insights page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    await this.page.locator(selectors.navigation.insightsLink).click();
    await this.page.waitForURL(/\/w\/.*\/insights/, { timeout: 10000 });
  }

  /**
   * Check if Insights page title is visible
   */
  async isInsightsTitleVisible(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.insights).isVisible();
  }
}
