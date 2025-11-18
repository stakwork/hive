import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Capacity page
 * Encapsulates all capacity page interactions and assertions
 */
export class CapacityPage {
  constructor(private page: Page) {}

  /**
   * Navigate to capacity page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/capacity`);
    await this.waitForLoad();
  }

  /**
   * Wait for capacity page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.capacity)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify the page title is "Capacity"
   */
  async verifyTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.capacity)).toBeVisible();
    await expect(this.page.locator(selectors.pageTitle.element)).toContainText('Capacity');
  }

  /**
   * Check if the page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.capacity).isVisible();
  }

  /**
   * Navigate from current page to capacity via sidebar
   */
  async navigateFromSidebar(): Promise<void> {
    const capacityLink = this.page.locator(selectors.navigation.capacityLink);
    await expect(capacityLink).toBeVisible({ timeout: 10000 });
    await capacityLink.click();
    await this.page.waitForURL(/\/w\/.*\/capacity/, { timeout: 10000 });
    await this.waitForLoad();
  }

  /**
   * Verify capacity page URL pattern
   */
  async verifyURL(workspaceSlug: string): Promise<void> {
    const expectedPattern = new RegExp(`/w/${workspaceSlug}/capacity`);
    await expect(this.page).toHaveURL(expectedPattern);
  }
}
