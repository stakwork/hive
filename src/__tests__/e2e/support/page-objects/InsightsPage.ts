import { Page } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers';

export class InsightsPage {
  constructor(private page: Page) {}
  
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/insights`);
  }
  
  async waitForLoad(): Promise<void> {
    await waitForElement(this.page, selectors.pageTitle.insights);
  }
  
  async clickToggleButton(): Promise<void> {
    // Handle modal dialogs that might intercept clicks
    try {
      // First check if there's a blocking dialog/modal
      const modal = this.page.locator('div[role="dialog"]');
      if (await modal.isVisible()) {
        // Try to close the modal first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }
    } catch (error) {
      // Ignore modal handling errors
    }
    
    // Use Playwright's first() locator method instead of CSS :first selector
    await this.page.locator(selectors.insights.toggleButton).first().click();
  }
  
  async isPanelExpanded(): Promise<boolean> {
    // Check if the first toggle button is checked/expanded
    // The switch buttons have data-state attribute that indicates if they're on/off
    try {
      const firstToggle = this.page.locator(selectors.insights.toggleButton).first();
      const state = await firstToggle.getAttribute('data-state');
      return state === 'checked';
    } catch (error) {
      // Fallback to checking for expanded elements
      const expandedElements = [
        'div[data-state="open"]',
        'div[aria-expanded="true"]',
        '.expanded',
        '[data-expanded="true"]',
        'div[data-collapsible="open"]'
      ];
      
      for (const selector of expandedElements) {
        try {
          const element = this.page.locator(selector);
          if (await element.count() > 0) {
            return await element.first().isVisible();
          }
        } catch (error) {
          // Continue to next selector
        }
      }
      
      // Default fallback - assume not expanded if no expanded elements found
      return false;
    }
  }
  
  async togglePanelMultipleTimes(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.clickToggleButton();
      // Wait for panel animation to complete
      await this.page.waitForSelector(selectors.insights.toggleButton, { state: 'attached' });
    }
  }
}