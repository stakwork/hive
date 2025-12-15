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
   * Navigate to testing page via sidebar navigation
   */
  async navigateViaNavigation(): Promise<void> {
    // First expand the Protect section if not already expanded
    const protectButton = this.page.locator(selectors.navigation.protectButton);
    const testingLink = this.page.locator('a:has-text("Testing")').first();

    // Check if testing link is visible, if not, click Protect to expand
    const isTestingVisible = await testingLink.isVisible().catch(() => false);
    if (!isTestingVisible) {
      await protectButton.click();
      await testingLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await testingLink.click();
    await this.page.waitForURL(/\/w\/.*\/testing/, { timeout: 10000 });
    await this.waitForLoad();
  }

  /**
   * Switch to the User Journeys tab
   */
  async switchToUserJourneysTab(): Promise<void> {
    const userJourneysTab = this.page.locator(selectors.testing.userJourneysTab);
    await userJourneysTab.waitFor({ state: 'visible', timeout: 5000 });
    await userJourneysTab.click();
    // Wait for the tab content to be visible
    await this.page.waitForTimeout(500); // Small wait for tab transition
  }

  /**
   * Click the Create User Journey button
   */
  async clickCreateUserJourney(): Promise<void> {
    const createButton = this.page.locator(selectors.userJourneys.createButton);
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.click();
  }

  /**
   * Check if browser panel is visible (indicates pod was claimed)
   */
  async isBrowserPanelVisible(): Promise<boolean> {
    try {
      // Look for iframe or browser panel indicators
      const iframeSelector = 'iframe[src*="http"]';
      await this.page.waitForSelector(iframeSelector, { timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for pod to be claimed and browser panel to appear
   */
  async waitForPodClaim(): Promise<void> {
    // Wait for the browser panel iframe to appear
    const iframeSelector = 'iframe[src*="http"]';
    await expect(this.page.locator(iframeSelector)).toBeVisible({ timeout: 30000 });
  }

  /**
   * Check if the Testing page title is visible
   */
  async isPageTitleVisible(): Promise<boolean> {
    return await this.page.locator(selectors.pageTitle.testing).isVisible();
  }

  /**
   * Check if the User Journeys tab is visible
   */
  async isUserJourneysTabVisible(): Promise<boolean> {
    return await this.page.locator(selectors.testing.userJourneysTab).isVisible();
  }

  /**
   * Check if Create User Journey button is visible
   */
  async isCreateButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.userJourneys.createButton).isVisible();
  }
}
