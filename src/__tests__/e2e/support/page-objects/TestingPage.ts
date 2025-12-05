import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Testing page
 * Encapsulates all testing page interactions and assertions
 */
export class TestingPage {
  constructor(private page: Page) {}

  /**
   * Navigate to testing page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/testing`);
    await this.waitForLoad();
  }

  /**
   * Wait for testing page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.testing)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page title is "Testing"
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.element)).toContainText('Testing');
  }

  /**
   * Check if testing page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.testing).isVisible();
  }
}
