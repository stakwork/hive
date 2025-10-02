import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Insights page
 */
export class InsightsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to insights page
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/insights`);
    await this.waitForLoad();
  }

  /**
   * Wait for insights page to load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.insights)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page description
   */
  async verifyDescription(): Promise<void> {
    await expect(this.page.locator('text=/Automated codebase analysis/i')).toBeVisible();
  }

  /**
   * Check if test coverage card is visible
   */
  async hasCoverageCard(): Promise<boolean> {
    const card = this.page.locator(selectors.insights.coverageCard).first();
    return await card.isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Verify all janitor sections are visible
   */
  async verifyJanitorSections(): Promise<void> {
    await expect(this.page.locator(selectors.insights.testingSection).first()).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(selectors.insights.securitySection).first()).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(selectors.insights.maintainabilitySection).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if recommendations section exists
   */
  async hasRecommendationsSection(): Promise<boolean> {
    const section = this.page.locator(selectors.insights.recommendationsSection).first();
    return await section.count() > 0;
  }

  /**
   * Check if specific janitor items are visible
   */
  async hasJanitorItems(): Promise<boolean> {
    const unitTest = this.page.locator(selectors.insights.unitTestJanitor).first();
    const integrationTest = this.page.locator(selectors.insights.integrationTestJanitor).first();

    const hasUnit = await unitTest.isVisible({ timeout: 5000 }).catch(() => false);
    const hasIntegration = await integrationTest.isVisible({ timeout: 5000 }).catch(() => false);

    return hasUnit || hasIntegration;
  }

  /**
   * Toggle janitor configuration if available
   */
  async toggleJanitorConfig(): Promise<boolean> {
    const toggle = this.page.locator(selectors.insights.toggleButton).first();

    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      const initialState = await toggle.getAttribute('aria-checked') ||
                          await toggle.isChecked().catch(() => 'false');

      await toggle.click();
      await this.page.waitForTimeout(500);

      const newState = await toggle.getAttribute('aria-checked') ||
                       await toggle.isChecked().catch(() => 'false');

      return newState !== initialState;
    }

    return false;
  }

  /**
   * Check if empty state or recommendations exist
   */
  async hasRecommendationsOrEmptyState(): Promise<boolean> {
    await this.page.waitForTimeout(2000);

    const recommendations = this.page.locator('[data-recommendation-id], .recommendation-item').first();
    const emptyState = this.page.locator('text=/No recommendations|No insights/i').first();

    const hasItems = await recommendations.count() > 0;
    const isEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);

    return hasItems || isEmpty;
  }

  /**
   * Dismiss a recommendation if available
   */
  async dismissRecommendation(): Promise<boolean> {
    const dismissButton = this.page.locator(selectors.insights.dismissButton).first();

    if (await dismissButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dismissButton.click();
      await this.page.waitForTimeout(1000);
      return true;
    }

    return false;
  }

  /**
   * Navigate back to dashboard
   */
  async goToDashboard(): Promise<void> {
    const dashboardLink = this.page.locator(selectors.navigation.dashboardLink).first();
    await dashboardLink.click();
    await this.page.waitForURL(/\/w\/.*\/$|\/w\/[^\/]+$/, { timeout: 10000 });
  }
}
