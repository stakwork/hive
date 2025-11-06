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
   * Navigate to insights via navigation link
   */
  async navigateViaNavigation(): Promise<void> {
    await this.page.locator(selectors.navigation.insightsLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/insights/, { timeout: 10000 });
    await this.waitForLoad();
  }

  /**
   * Check if Secret Scanner card is visible
   */
  async isSecretScannerCardVisible(): Promise<boolean> {
    return await this.page.locator(selectors.insights.secretScannerCard).isVisible();
  }

  /**
   * Assert Secret Scanner card is visible
   */
  async assertSecretScannerVisible(): Promise<void> {
    await expect(this.page.locator(selectors.insights.secretScannerCard)).toBeVisible();
  }

  /**
   * Assert Secret Scanner title contains expected text
   */
  async assertSecretScannerTitle(): Promise<void> {
    const titleLocator = this.page.locator(selectors.insights.secretScannerTitle);
    await expect(titleLocator).toBeVisible();
    await expect(titleLocator).toContainText('Secret Scanner');
  }

  /**
   * Click the Run Scan button on Secret Scanner card
   */
  async clickRunScan(): Promise<void> {
    await this.page.locator(selectors.insights.secretScannerRunButton).click();
  }

  /**
   * Scroll to Secret Scanner card
   */
  async scrollToSecretScanner(): Promise<void> {
    await this.page.locator(selectors.insights.secretScannerCard).scrollIntoViewIfNeeded();
  }

  /**
   * Get Secret Scanner card locator
   */
  getSecretScannerCard() {
    return this.page.locator(selectors.insights.secretScannerCard);
  }

  /**
   * Check if page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.insights).isVisible();
  }
}
