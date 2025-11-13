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
   * Waits for the chat area and page title to be visible
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.learn.chatArea)).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(selectors.learn.pageTitle)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify the page title is correct
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.learn.pageTitle)).toContainText('Learning Assistant');
  }

  /**
   * Verify the welcome message is visible
   */
  async verifyWelcomeMessage(): Promise<void> {
    await expect(this.page.locator(selectors.learn.welcomeMessage)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if learn page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.learn.chatArea).isVisible();
  }

  /**
   * Reload the page
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }
}
