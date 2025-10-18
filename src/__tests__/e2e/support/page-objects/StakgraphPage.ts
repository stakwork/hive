import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Stakgraph Configuration
 */
export class StakgraphPage {
  constructor(private page: Page) {}

  /**
   * Navigate directly to stakgraph configuration page
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/stakgraph`);
    await this.waitForLoad();
  }

  /**
   * Wait for the stakgraph page to load
   */
  async waitForLoad(): Promise<void> {
    // Wait for page header to be visible
    const pageHeader = this.page.locator(selectors.stakgraph.pageHeader);
    await expect(pageHeader).toBeVisible({ timeout: 10000 });

    // Wait for page title to contain "Pool Status"
    const pageTitle = this.page.locator(selectors.stakgraph.pageTitle);
    await expect(pageTitle).toContainText('Pool Status', { timeout: 10000 });

    // Wait for card title to be visible
    const cardTitle = this.page.locator(selectors.stakgraph.cardTitle);
    await expect(cardTitle).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to stakgraph configuration from settings page
   * (via Pool Status section dropdown menu)
   */
  async goToConfigurationFromSettings(): Promise<void> {
    // Wait for Pool Status section to be visible
    const poolStatusSection = this.page.locator(selectors.stakgraph.poolStatusSection);
    await expect(poolStatusSection).toBeVisible({ timeout: 10000 });

    // Click the dropdown menu button (three dots)
    const dropdownButton = poolStatusSection.locator('button').first();
    await dropdownButton.click();

    // Click the Edit Configuration link
    const editLink = this.page.locator(selectors.stakgraph.editConfigurationLink);
    await expect(editLink).toBeVisible({ timeout: 5000 });
    await editLink.click();

    // Wait for stakgraph page to load
    await this.waitForLoad();
  }

  /**
   * Assert that the configuration page is visible with correct elements
   */
  async assertConfigurationVisible(): Promise<void> {
    // Check page header
    const pageHeader = this.page.locator(selectors.stakgraph.pageHeader);
    await expect(pageHeader).toBeVisible();
    await expect(pageHeader).toContainText('Pool Status');

    // Check card title
    const cardTitle = this.page.locator(selectors.stakgraph.cardTitle);
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toContainText('Pool Settings');

    // Check save button exists
    const saveButton = this.page.locator(selectors.stakgraph.saveButton);
    await expect(saveButton).toBeVisible();
  }

  /**
   * Assert page title contains expected text
   */
  async assertPageTitle(expectedText: string): Promise<void> {
    const pageHeader = this.page.locator(selectors.stakgraph.pageHeader);
    await expect(pageHeader).toContainText(expectedText);
  }

  /**
   * Assert card title contains expected text
   */
  async assertCardTitle(expectedText: string): Promise<void> {
    const cardTitle = this.page.locator(selectors.stakgraph.cardTitle);
    await expect(cardTitle).toContainText(expectedText);
  }

  /**
   * Get the save button element
   */
  getSaveButton() {
    return this.page.locator(selectors.stakgraph.saveButton);
  }

  /**
   * Verify current URL is stakgraph page
   */
  async verifyUrl(workspaceSlug: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/w/${workspaceSlug}/stakgraph`));
  }
}
