import { Page, expect } from "@playwright/test";
import { selectors } from "../fixtures/selectors";

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
   * Verify page title is "Capacity"
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.element)).toContainText("Capacity");
  }

  /**
   * Check if capacity page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.capacity).isVisible();
  }
}
