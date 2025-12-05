import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Recommendations page
 * Encapsulates all recommendations page interactions and assertions
 */
export class RecommendationsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to recommendations page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/recommendations`);
    await this.waitForLoad();
  }

  /**
   * Wait for recommendations page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.recommendations)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page title is "Recommendations"
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.element)).toContainText('Recommendations');
  }

  /**
   * Check if recommendations page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.recommendations).isVisible();
  }
}
