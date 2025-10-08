import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, InsightsPage } from '@/__tests__/e2e/support/page-objects';
import { assertVisible, assertURLPattern } from '@/__tests__/e2e/support/helpers/assertions';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

/**
 * E2E Test: User Journey for Insights Navigation and Actions
 * 
 * This test replicates the recorded user journey:
 * 1. User signs in with mock auth
 * 2. Navigates to a workspace  
 * 3. Clicks on Insights navigation
 * 4. Performs actions on the Insights page (clicking buttons)
 */
test.describe('Insights User Journey', () => {
  test('should successfully navigate to insights and interact with buttons', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const insightsPage = new InsightsPage(page);
    
    // 1. Navigate to home page and sign in with mock auth
    await page.goto('/');
    await authPage.signInWithMock();
    await authPage.waitForSignIn();
    
    // 2. Navigate to the test workspace
    await dashboardPage.goto(scenario.workspace.slug);
    await dashboardPage.waitForLoad();
    
    // 3. Click on Insights navigation link
    await insightsPage.navigateToInsights();
    
    // 4. Wait for Insights page to load and verify URL
    await insightsPage.waitForLoad();
    await assertURLPattern(page, new RegExp(`/w/${scenario.workspace.slug}/insights`));
    
    // 5. Verify key elements are visible
    await insightsPage.waitForElementsVisible();
    
    // 6. Perform actions based on the recorded test
    // The click stream shows interactions with various buttons
    
    // Check if recommendation buttons are present and interact
    const hasAcceptButton = await insightsPage.isAcceptButtonVisible();
    if (hasAcceptButton) {
      // Click dismiss button first (as shown in click stream)
      await insightsPage.dismissRecommendation();
    }
    
    // Check if janitor controls are present and interact
    const hasJanitorSwitch = await insightsPage.isJanitorToggleSwitchVisible();
    if (hasJanitorSwitch) {
      // Toggle janitor switch (simulating the recorded clicks)
      await insightsPage.toggleJanitorSwitch();
    }
    
    const hasManualRunButton = await insightsPage.isManualRunButtonVisible();
    if (hasManualRunButton) {
      // Click manual run button (as shown in click stream)
      await insightsPage.clickManualRunButton();
    }
    
    // Verify we're still on the insights page after interactions
    await assertURLPattern(page, new RegExp(`/w/${scenario.workspace.slug}/insights`));
  });
});
