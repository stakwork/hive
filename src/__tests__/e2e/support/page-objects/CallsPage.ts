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
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/calls`);
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
    return await this.page.locator(selectors.calls.startCallButton).isVisible();
  }

  /**
   * Check if Call Recordings card is visible
   */
  async isCallRecordingsCardVisible(): Promise<boolean> {
    return await this.page.locator(selectors.calls.callRecordingsCard).isVisible();
  }

  /**
   * Navigate to calls page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    // First, expand Context section if it's not already expanded
    const contextButton = this.page.locator('[data-testid="nav-context"]');
    const callsLink = this.page.locator(selectors.navigation.callsLink);

    // Check if calls link is visible, if not, click context to expand
    const isCallsVisible = await callsLink.isVisible().catch(() => false);
    if (!isCallsVisible) {
      await contextButton.click();
      // Wait for calls link to become visible after expanding
      await callsLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await callsLink.click();
    await this.page.waitForURL(/\/w\/.*\/calls/, { timeout: 10000 });
  }
}
