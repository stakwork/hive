import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Insights page
 * Encapsulates all insights interactions and assertions
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
   * Click the Accept button on a recommendation
   * @param index - Optional index of the recommendation (0-based). Defaults to first recommendation.
   */
  async clickRecommendationAccept(index: number = 0): Promise<void> {
    const acceptButtons = this.page.locator(selectors.insights.recommendationAcceptButton);
    await acceptButtons.nth(index).click();
  }

  /**
   * Click the Dismiss button on a recommendation
   * @param index - Optional index of the recommendation (0-based). Defaults to first recommendation.
   */
  async clickRecommendationDismiss(index: number = 0): Promise<void> {
    const dismissButtons = this.page.locator(selectors.insights.recommendationDismissButton);
    await dismissButtons.nth(index).click();
  }

  /**
   * Get count of recommendation cards
   */
  async getRecommendationCount(): Promise<number> {
    return await this.page.locator(selectors.insights.recommendationCard).count();
  }

  /**
   * Check if recommendations section is visible
   */
  async hasRecommendations(): Promise<boolean> {
    const count = await this.getRecommendationCount();
    return count > 0;
  }

  /**
   * Wait for a specific recommendation count
   */
  async waitForRecommendationCount(count: number): Promise<void> {
    await expect(this.page.locator(selectors.insights.recommendationCard)).toHaveCount(count, { timeout: 10000 });
  }

  /**
   * Check if insights page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.insights).isVisible();
  }

  /**
   * Reload the page
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }
}
