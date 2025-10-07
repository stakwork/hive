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
   * Wait for recommendations to load
   */
  async waitForRecommendationsLoad(): Promise<void> {
    // Wait for either recommendations to appear or the empty state
    await this.page.waitForFunction(() => {
      const loadingElements = document.querySelectorAll('[data-testid*="loading"], .animate-spin');
      return loadingElements.length === 0;
    }, { timeout: 10000 });
  }

  /**
   * Check if at least one recommendation is visible
   */
  async hasRecommendations(): Promise<boolean> {
    const acceptButtons = this.page.locator(selectors.insights.acceptButton);
    const count = await acceptButtons.count();
    return count > 0;
  }

  /**
   * Click the first recommendation's accept button
   */
  async clickFirstRecommendationAccept(): Promise<void> {
    await this.waitForRecommendationsLoad();
    const acceptButton = this.page.locator(selectors.insights.acceptButton).first();
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();
  }

  /**
   * Click the first recommendation's dismiss button
   */
  async clickFirstRecommendationDismiss(): Promise<void> {
    await this.waitForRecommendationsLoad();
    const dismissButton = this.page.locator(selectors.insights.dismissButton).first();
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
  }

  /**
   * Get the count of visible recommendations
   */
  async getRecommendationCount(): Promise<number> {
    await this.waitForRecommendationsLoad();
    return await this.page.locator(selectors.insights.acceptButton).count();
  }

  /**
   * Assert that the recommendations section is visible
   */
  async assertRecommendationsSectionVisible(): Promise<void> {
    await expect(this.page.locator(selectors.insights.recommendationsSection)).toBeVisible();
  }

  /**
   * Assert that at least one recommendation is visible
   */
  async assertRecommendationsVisible(): Promise<void> {
    await this.waitForRecommendationsLoad();
    await expect(this.page.locator(selectors.insights.acceptButton).first()).toBeVisible();
  }

  /**
   * Assert that a toast message appears (for feedback after actions)
   */
  async assertToastMessage(expectedText?: string): Promise<void> {
    const toastSelector = '[data-sonner-toaster] [data-sonner-toast], .toast, [role="alert"]';
    const toast = this.page.locator(toastSelector).first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    
    if (expectedText) {
      await expect(toast).toContainText(expectedText);
    }
  }

  /**
   * Wait for and verify that recommendations have been refreshed/updated
   */
  async waitForRecommendationUpdate(): Promise<void> {
    // Wait a short time for any UI updates
    await this.page.waitForTimeout(1000);
    await this.waitForRecommendationsLoad();
  }
}
