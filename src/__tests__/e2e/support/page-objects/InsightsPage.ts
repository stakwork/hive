import { Page } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object for Insights page interactions
 */
export class InsightsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the Insights page
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/insights`);
  }

  /**
   * Wait for the Insights page to load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForSelector(selectors.pageTitle.insights, { 
      state: 'visible',
      timeout: 10000 
    });
  }

  /**
   * Navigate to insights using the navigation link
   */
  async navigateToInsights(): Promise<void> {
    await this.page.locator(selectors.navigation.insightsLink).click();
  }

  /**
   * Click accept button on a recommendation
   */
  async acceptRecommendation(): Promise<void> {
    await this.page.locator(selectors.insights.acceptButton).click();
  }

  /**
   * Click dismiss button on a recommendation  
   */
  async dismissRecommendation(): Promise<void> {
    await this.page.locator(selectors.insights.dismissButton).click();
  }

  /**
   * Toggle a janitor switch
   */
  async toggleJanitorSwitch(): Promise<void> {
    await this.page.locator(selectors.insights.janitorToggleSwitch).first().click();
  }

  /**
   * Click manual run button for a janitor
   */
  async clickManualRunButton(): Promise<void> {
    await this.page.locator(selectors.insights.janitorManualRunButton).first().click();
  }

  /**
   * Wait for specific elements to be visible
   */
  async waitForElementsVisible(): Promise<void> {
    // Wait for key sections to be visible
    await this.page.locator(selectors.insights.testingSection).waitFor({ 
      state: 'visible',
      timeout: 10000 
    });
  }

  /**
   * Check if accept button is visible
   */
  async isAcceptButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.insights.acceptButton).isVisible();
  }

  /**
   * Check if dismiss button is visible
   */
  async isDismissButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.insights.dismissButton).isVisible();
  }

  /**
   * Check if janitor toggle switch is visible
   */
  async isJanitorToggleSwitchVisible(): Promise<boolean> {
    return await this.page.locator(selectors.insights.janitorToggleSwitch).first().isVisible();
  }

  /**
   * Check if manual run button is visible
   */
  async isManualRunButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.insights.janitorManualRunButton).first().isVisible();
  }
}
