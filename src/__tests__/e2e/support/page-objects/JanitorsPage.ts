import { Page, expect } from '@playwright/test';
import { selectors, dynamicSelectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers/waits';

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
    await expect(this.page.locator(selectors.janitors.pageTitle)).toBeVisible({ timeout: 10000 });
    // Wait for at least one janitor section to load
    await expect(this.page.locator(selectors.janitors.testingSection)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Toggle a janitor on or off
   * @param janitorId - The ID of the janitor (e.g., 'UNIT_TESTS', 'INTEGRATION_TESTS')
   */
  async toggleJanitor(janitorId: string): Promise<void> {
    const toggleSelector = dynamicSelectors.janitorToggle(janitorId);
    const toggle = this.page.locator(toggleSelector);
    
    // Wait for toggle to be visible and enabled
    await waitForElement(this.page, toggleSelector);
    await expect(toggle).toBeEnabled();
    
    // Get current state before toggling
    const wasChecked = await toggle.getAttribute('data-state') === 'checked';
    
    await toggle.click();
    
    // Wait for the state to change
    await this.page.waitForFunction(
      ({ selector, expectedState }) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const currentState = element.getAttribute('data-state') === 'checked';
        return currentState === expectedState;
      },
      { selector: toggleSelector, expectedState: !wasChecked },
      { timeout: 5000 }
    );
  }

  /**
   * Manually run a janitor
   * @param janitorId - The ID of the janitor to run
   */
  async runJanitor(janitorId: string): Promise<void> {
    const runButtonSelector = dynamicSelectors.janitorRunButton(janitorId);
    const runButton = this.page.locator(runButtonSelector);
    
    // Wait for run button to be visible and enabled
    await waitForElement(this.page, runButtonSelector);
    await expect(runButton).toBeEnabled();
    
    await runButton.click();
  }

  /**
   * Check if a janitor is toggled on
   * @param janitorId - The ID of the janitor
   * @returns true if janitor is on, false otherwise
   */
  async isJanitorEnabled(janitorId: string): Promise<boolean> {
    const toggleSelector = dynamicSelectors.janitorToggle(janitorId);
    const toggle = this.page.locator(toggleSelector);
    
    await waitForElement(this.page, toggleSelector);
    
    // Check if the switch is in checked state
    const isChecked = await toggle.getAttribute('data-state');
    return isChecked === 'checked';
  }

  /**
   * Check if a janitor run button is visible
   * @param janitorId - The ID of the janitor
   * @returns true if run button is visible, false otherwise
   */
  async isRunButtonVisible(janitorId: string): Promise<boolean> {
    const runButtonSelector = dynamicSelectors.janitorRunButton(janitorId);
    return await this.page.locator(runButtonSelector).isVisible();
  }

  /**
   * Check if a janitor run button is running (showing spinner)
   * @param janitorId - The ID of the janitor
   * @returns true if janitor is running, false otherwise
   */
  async isJanitorRunning(janitorId: string): Promise<boolean> {
    const runButtonSelector = dynamicSelectors.janitorRunButton(janitorId);
    const runButton = this.page.locator(runButtonSelector);
    
    // Check if button contains a spinning loader icon
    const hasSpinner = await runButton.locator('svg.animate-spin').isVisible().catch(() => false);
    return hasSpinner;
  }

  /**
   * Wait for a toast message to appear
   * @param message - The message text to wait for
   */
  async waitForToast(message: string): Promise<void> {
    const toastSelector = `text="${message}"`;
    await waitForElement(this.page, toastSelector, 5000);
  }

  /**
   * Assert that a janitor is enabled
   * @param janitorId - The ID of the janitor
   */
  async assertJanitorEnabled(janitorId: string): Promise<void> {
    const isEnabled = await this.isJanitorEnabled(janitorId);
    expect(isEnabled).toBe(true);
  }

  /**
   * Assert that a janitor is disabled
   * @param janitorId - The ID of the janitor
   */
  async assertJanitorDisabled(janitorId: string): Promise<void> {
    const isEnabled = await this.isJanitorEnabled(janitorId);
    expect(isEnabled).toBe(false);
  }

  /**
   * Assert that a janitor run button is visible
   * @param janitorId - The ID of the janitor
   */
  async assertRunButtonVisible(janitorId: string): Promise<void> {
    const isVisible = await this.isRunButtonVisible(janitorId);
    expect(isVisible).toBe(true);
  }

  /**
   * Assert that a janitor run button is not visible
   * @param janitorId - The ID of the janitor
   */
  async assertRunButtonNotVisible(janitorId: string): Promise<void> {
    const isVisible = await this.isRunButtonVisible(janitorId);
    expect(isVisible).toBe(false);
  }

  /**
   * Assert that the janitors page is loaded
   */
  async assertPageLoaded(): Promise<void> {
    await expect(this.page.locator(selectors.janitors.pageTitle)).toBeVisible();
    await expect(this.page.locator(selectors.janitors.testingSection)).toBeVisible();
  }
}
