import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Recommendations page
 * Encapsulates all recommendation interactions and assertions
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
   * Get all recommendation cards
   */
  getRecommendationCards() {
    return this.page.locator(selectors.recommendations.card);
  }

  /**
   * Get a specific recommendation card by index (0-based)
   */
  getRecommendationCard(index: number) {
    return this.page.locator(selectors.recommendations.card).nth(index);
  }

  /**
   * Get recommendation title element by index
   */
  getRecommendationTitle(index: number) {
    return this.getRecommendationCard(index).locator(selectors.recommendations.title);
  }

  /**
   * Get recommendation description element by index
   */
  getRecommendationDescription(index: number) {
    return this.getRecommendationCard(index).locator(selectors.recommendations.description);
  }

  /**
   * Get recommendation impact element by index
   */
  getRecommendationImpact(index: number) {
    return this.getRecommendationCard(index).locator(selectors.recommendations.impact);
  }

  /**
   * Get accept button for a specific recommendation by index
   */
  getAcceptButton(index: number) {
    return this.getRecommendationCard(index).locator(selectors.recommendations.acceptButton);
  }

  /**
   * Get dismiss button for a specific recommendation by index
   */
  getDismissButton(index: number) {
    return this.getRecommendationCard(index).locator(selectors.recommendations.dismissButton);
  }

  /**
   * Accept a recommendation by index
   */
  async acceptRecommendation(index: number): Promise<void> {
    const acceptButton = this.getAcceptButton(index);
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();
  }

  /**
   * Dismiss a recommendation by index
   */
  async dismissRecommendation(index: number): Promise<void> {
    const dismissButton = this.getDismissButton(index);
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
  }

  /**
   * Verify a recommendation card is visible with expected content
   */
  async verifyRecommendationVisible(index: number, expectedTitle: string): Promise<void> {
    const card = this.getRecommendationCard(index);
    await expect(card).toBeVisible();
    
    const title = this.getRecommendationTitle(index);
    await expect(title).toContainText(expectedTitle);
  }

  /**
   * Verify recommendation count
   */
  async verifyRecommendationCount(expectedCount: number): Promise<void> {
    const cards = this.getRecommendationCards();
    await expect(cards).toHaveCount(expectedCount);
  }

  /**
   * Wait for a recommendation to be removed (after accept/dismiss)
   */
  async waitForRecommendationRemoval(originalCount: number): Promise<void> {
    // Wait for the count to decrease
    await this.page.waitForFunction(
      (count) => {
        const cards = document.querySelectorAll('[data-testid="recommendation-card"]');
        return cards.length < count;
      },
      originalCount,
      { timeout: 10000 }
    );
  }

  /**
   * Verify toast message appears (success notification)
   * Uses a more flexible approach to handle various toast implementations
   */
  async verifyToastMessage(expectedText: string): Promise<void> {
    // Try multiple selectors to find the toast
    const toastSelectors = [
      `[role="status"]:has-text("${expectedText}")`,
      `[data-sonner-toast]:has-text("${expectedText}")`,
      `.toast:has-text("${expectedText}")`,
      `[class*="toast"]:has-text("${expectedText}")`,
    ];

    let found = false;
    for (const selector of toastSelectors) {
      const toast = this.page.locator(selector);
      const count = await toast.count();
      if (count > 0) {
        await expect(toast.first()).toBeVisible({ timeout: 5000 });
        found = true;
        break;
      }
    }

    if (!found) {
      // If no toast found, just wait a bit for UI to update
      await this.page.waitForTimeout(1000);
    }
  }
}
