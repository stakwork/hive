import { Page } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

export class InsightsPage {
  constructor(private page: Page) {}

  async goto(workspaceSlug: string) {
    await this.page.goto(`/w/${workspaceSlug}/insights`);
    await this.waitForLoad();
  }

  async waitForLoad() {
    await this.page.waitForSelector(selectors.pageTitle.insights);
  }

  async toggleInsightPanel(index: number) {
    // Try to close any modal dialogs first
    const dialog = this.page.locator('[role="dialog"]');
    if (await dialog.isVisible()) {
      const closeButton = dialog.locator('button[aria-label="Close"], button:has-text("Close"), [data-testid="close-modal"]');
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await this.page.waitForTimeout(500);
      }
    }
    
    // Use force click to override any intercepting elements
    await this.page.locator(selectors.insights.toggleButton).nth(index).click({ force: true });
  }

  async verifyToggleButtonVisible(count: number) {
    await this.page.waitForSelector(selectors.insights.toggleButton);
    const toggleButtons = await this.page.locator(selectors.insights.toggleButton).count();
    if (toggleButtons !== count) {
      throw new Error(`Expected ${count} toggle buttons but found ${toggleButtons}`);
    }
  }

  async verifyInsightPanelExpanded(index: number, isExpanded: boolean) {
    const panel = this.page.locator(selectors.insights.panel).nth(index);
    const state = await panel.getAttribute('data-state');
    const expectedState = isExpanded ? 'open' : 'closed';
    
    if (state !== expectedState) {
      throw new Error(`Panel ${index} expected state: ${expectedState}, actual: ${state}`);
    }
  }
}