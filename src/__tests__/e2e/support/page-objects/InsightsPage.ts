import { Page } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { assertVisible, assertHidden } from '../helpers/assertions';
import { waitForElement } from '../helpers/waits';

export class InsightsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the Insights page
   */
  async goto(workspaceSlug: string) {
    await this.page.goto(`/w/${workspaceSlug}/insights`);
    await this.waitForLoad();
  }

  /**
   * Wait for the Insights page to load
   */
  async waitForLoad() {
    await waitForElement(this.page, selectors.pageTitle.insights);
  }

  /**
   * Toggle a janitor switch by index
   */
  async toggleJanitor(index: number) {
    const switches = await this.page.$$(selectors.insights.switchComponent);
    if (switches.length <= index) {
      throw new Error(`Switch at index ${index} not found. Only ${switches.length} switches available.`);
    }
    
    // First check if there are any modal dialogs blocking the interaction
    const modalDialogs = await this.page.$$('[role="dialog"]');
    if (modalDialogs.length > 0) {
      // Try to close any modal dialogs by pressing escape
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(200);
    }
    
    // Use force click to bypass any overlay issues
    await switches[index].click({ force: true });
    
    // Wait for UI to respond to toggle
    await this.page.waitForTimeout(100);
  }

  /**
   * Assert the state of a janitor switch
   */
  async assertJanitorState(index: number, isEnabled: boolean) {
    const switches = await this.page.$$(selectors.insights.switchComponent);
    if (switches.length <= index) {
      throw new Error(`Switch at index ${index} not found. Only ${switches.length} switches available.`);
    }
    
    const switchElement = switches[index];
    const ariaChecked = await switchElement.getAttribute('aria-checked');
    const isChecked = ariaChecked === 'true';
    
    if (isEnabled !== isChecked) {
      throw new Error(`Expected switch at index ${index} to be ${isEnabled ? 'enabled' : 'disabled'}, but it was ${isChecked ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get the total number of janitor switches on the page
   */
  async getJanitorSwitchCount() {
    const switches = await this.page.$$(selectors.insights.switchComponent);
    return switches.length;
  }

  /**
   * Get the total number of janitor items on the page
   */
  async getJanitorItemCount() {
    const items = await this.page.$$(selectors.insights.janitorItem);
    return items.length;
  }
}