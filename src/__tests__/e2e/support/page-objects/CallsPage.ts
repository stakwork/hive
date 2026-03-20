import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Calls page
 * Encapsulates all calls page interactions and assertions
 */
export class CallsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to calls page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/context/calls`);
    await this.waitForLoad();
  }

  /**
   * Wait for calls page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.calls)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Click the Start Call button
   */
  async clickStartCall(): Promise<void> {
    await this.page.locator(selectors.calls.startCallButton).click();
  }

  /**
   * Check if Start Call button is visible
   */
  async isStartCallButtonVisible(): Promise<boolean> {
    try {
      return await this.page.locator(selectors.calls.startCallButton).isVisible();
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if Call Recordings card is visible
   */
  async isCallRecordingsCardVisible(): Promise<boolean> {
    try {
      return await this.page.locator(selectors.calls.callRecordingsCard).isVisible();
    } catch (error) {
      return false;
    }
  }

  /**
   * Navigate to calls page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    // Click the single Context link in the sidebar — it redirects to /context/learn,
    // then navigate directly to /context/calls via the tab bar
    const contextLink = this.page.locator(selectors.navigation.contextButton);
    await contextLink.click();
    await this.page.waitForURL(/\/w\/.*\/context\/learn/, { timeout: 10000 });

    // Click the Calls tab
    await this.page.locator('a[href*="/context/calls"]').first().click();
    await this.page.waitForURL(/\/w\/.*\/context\/calls/, { timeout: 10000 });
  }
}
