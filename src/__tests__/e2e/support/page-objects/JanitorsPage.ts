import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Janitors page
 * Encapsulates all janitors page interactions and assertions
 */
export class JanitorsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to janitors page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/janitors`);
    await this.waitForLoad();
  }

  /**
   * Wait for janitors page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.janitors)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page title is "Janitors"
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.element)).toContainText('Janitors');
  }

  /**
   * Check if janitors page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.janitors).isVisible();
  }
}
