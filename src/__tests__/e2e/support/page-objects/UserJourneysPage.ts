import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for User Journeys page
 * Encapsulates all user journeys page interactions and assertions
 */
export class UserJourneysPage {
  constructor(private page: Page) {}

  /**
   * Navigate to user journeys page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/user-journeys`);
    await this.waitForLoad();
  }

  /**
   * Wait for user journeys page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator('h1:has-text("User Journeys")')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to user journeys page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    await this.page.locator(selectors.navigation.userJourneysLink).click();
    await this.page.waitForURL(/\/w\/.*\/user-journeys/, { timeout: 10000 });
  }

  /**
   * Check if User Journeys heading is visible
   */
  async isUserJourneysHeadingVisible(): Promise<boolean> {
    return await this.page.locator('h1:has-text("User Journeys")').isVisible();
  }
}
