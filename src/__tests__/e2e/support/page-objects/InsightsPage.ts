import { Page, Locator } from '@playwright/test';
import { waitForNavigation } from '../helpers/navigation';

export class InsightsPage {
  readonly page: Page;
  
  // Element locators
  readonly insightsTitle: Locator;
  readonly settingsButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.insightsTitle = page.locator('h1:has-text("Insights")');
    this.settingsButton = page.locator('[data-testid="settings-button"]');
    this.cancelButton = page.locator('button:has-text("Cancel")');
  }

  /**
   * Wait for the insights page to be loaded
   */
  async waitForPageLoad() {
    await waitForNavigation(this.page, /\/w\/.*\/insights/, 10000);
    await this.insightsTitle.waitFor({ state: 'visible' });
  }

  /**
   * Open the settings page (renamed from openSettingsDropdown)
   */
  async openSettingsDropdown() {
    await this.settingsButton.waitFor({ state: 'visible' });
    await this.settingsButton.click();
  }

  /**
   * Click the cancel button in the dropdown
   * @deprecated This method is no longer applicable as settings button navigates to settings page
   */
  async clickCancelButton() {
    await this.cancelButton.waitFor({ state: 'visible' });
    await this.cancelButton.click();
  }

  /**
   * Navigate to the insights page from the workspace
   */
  async navigateToInsights(slug: string) {
    await this.page.goto(`http://localhost:3000/w/${slug}/insights`);
    await this.waitForPageLoad();
  }
}