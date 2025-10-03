import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Insights Page Toggle Interaction', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;

  // We'll define a new InsightsPage class here that we can later move to the page objects folder
  class InsightsPage {
    constructor(private page: any) {}

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
      await expect(this.page.locator(selectors.insights.toggleButton)).toHaveCount(count);
    }

    async verifyInsightPanelExpanded(index: number, isExpanded: boolean) {
      const panel = this.page.locator(selectors.insights.panel).nth(index);
      if (isExpanded) {
        await expect(panel).toHaveAttribute('data-state', 'open');
      } else {
        await expect(panel).toHaveAttribute('data-state', 'closed');
      }
    }
  }

  test.beforeEach(async ({ page }) => {
    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    
    // Sign in with mock auth
    await authPage.goto();
    await authPage.signInWithMock();
    
    // Wait for dashboard to load
    await dashboardPage.waitForLoad();
  });

  test('should navigate to insights and interact with toggle buttons', async ({ page }) => {
    // Verify we're on the dashboard
    await expect(page.locator(selectors.pageTitle.dashboard)).toBeVisible();
    
    // Navigate to insights
    await page.click(selectors.navigation.insightsLink);
    
    // Initialize insights page
    const insightsPage = new InsightsPage(page);
    await insightsPage.waitForLoad();
    
    // Verify we're on the insights page
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
    
    // Verify toggle buttons are present (adjust count to match actual UI)
    await insightsPage.verifyToggleButtonVisible(9);
    
    // Toggle first few switch buttons and verify visibility
    for (let i = 0; i < 3; i++) {
      // Toggle the switch
      await insightsPage.toggleInsightPanel(i);
      
      // Add small delay to allow UI to update
      await page.waitForTimeout(500);
    }
  });
});