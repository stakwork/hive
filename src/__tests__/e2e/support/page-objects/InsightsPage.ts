import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Insights page
 * Encapsulates all insights interactions and assertions
 */
export class InsightsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to insights page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/insights`);
    await this.waitForLoad();
  }

  /**
   * Wait for insights page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.insights)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get a janitor item by ID
   */
  getJanitorItem(janitorId: string) {
    return this.page.locator(selectors.insights.janitorItem(janitorId));
  }

  /**
   * Get a janitor name element by ID
   */
  getJanitorName(janitorId: string) {
    return this.page.locator(selectors.insights.janitorName(janitorId));
  }

  /**
   * Get a janitor status badge by ID
   */
  getJanitorStatus(janitorId: string) {
    return this.page.locator(selectors.insights.janitorStatus(janitorId));
  }

  /**
   * Get a janitor toggle switch by ID
   */
  getJanitorToggle(janitorId: string) {
    return this.page.locator(selectors.insights.janitorToggle(janitorId));
  }

  /**
   * Get a janitor run button by ID
   */
  getJanitorRunButton(janitorId: string) {
    return this.page.locator(selectors.insights.janitorRunButton(janitorId));
  }

  /**
   * Verify that a janitor is visible
   */
  async verifyJanitorVisible(janitorId: string): Promise<void> {
    await expect(this.getJanitorItem(janitorId)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify that a janitor has a specific name
   */
  async verifyJanitorName(janitorId: string, expectedName: string): Promise<void> {
    await expect(this.getJanitorName(janitorId)).toContainText(expectedName);
  }

  /**
   * Verify that a janitor has a specific status
   */
  async verifyJanitorStatus(janitorId: string, expectedStatus: 'Active' | 'Idle' | 'Coming Soon'): Promise<void> {
    const statusBadge = this.getJanitorStatus(janitorId);
    await expect(statusBadge).toContainText(expectedStatus);
  }

  /**
   * Click the toggle switch for a janitor
   */
  async clickJanitorToggle(janitorId: string): Promise<void> {
    const toggle = this.getJanitorToggle(janitorId);
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    // Wait a bit for the state to update
    await this.page.waitForTimeout(500);
  }

  /**
   * Click the run button for a janitor
   */
  async clickJanitorRunButton(janitorId: string): Promise<void> {
    const runButton = this.getJanitorRunButton(janitorId);
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await runButton.click();
  }

  /**
   * Verify that the run button is visible for a janitor
   */
  async verifyRunButtonVisible(janitorId: string): Promise<void> {
    await expect(this.getJanitorRunButton(janitorId)).toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify that the run button is NOT visible for a janitor
   */
  async verifyRunButtonNotVisible(janitorId: string): Promise<void> {
    await expect(this.getJanitorRunButton(janitorId)).not.toBeVisible();
  }

  /**
   * Wait for janitor toggle to be in a specific state
   */
  async waitForToggleState(janitorId: string, expectedState: boolean): Promise<void> {
    const toggle = this.getJanitorToggle(janitorId);
    
    if (expectedState) {
      await expect(toggle).toBeChecked({ timeout: 10000 });
    } else {
      await expect(toggle).not.toBeChecked({ timeout: 10000 });
    }
  }

  /**
   * Verify that the run button shows loading state
   */
  async verifyRunButtonLoading(janitorId: string): Promise<void> {
    const runButton = this.getJanitorRunButton(janitorId);
    // Check if the button contains a loader icon (has the animate-spin class in its children)
    await expect(runButton.locator('svg.animate-spin')).toBeVisible({ timeout: 5000 });
  }
}
