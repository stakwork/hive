import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Learn page
 * Encapsulates all learn page interactions and assertions
 */
export class LearnPage {
  constructor(private page: Page) {}

  /**
   * Navigate to learn page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/learn`);
    await this.waitForLoad();
  }

  /**
   * Wait for learn page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator('h1:has-text("Learning Assistant")')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to learn page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    await this.page.locator(selectors.navigation.learnLink).click();
    await this.page.waitForURL(/\/w\/.*\/learn/, { timeout: 10000 });
  }

  /**
   * Check if Learning Assistant heading is visible
   */
  async isLearnAssistantVisible(): Promise<boolean> {
    return await this.page.locator('h1:has-text("Learning Assistant")').isVisible();
  }
}
