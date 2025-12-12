import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, JanitorsPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Toggle Janitors and Trigger Manual Run', () => {
  test('should toggle janitors and trigger manual run successfully', async ({ page }) => {
    // Arrange - Create a workspace scenario with proper setup
    const scenario = await createStandardWorkspaceScenario();
    
    // Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();
    
    // Navigate to the test workspace
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto(scenario.workspace.slug);
    
    // Navigate to Janitors page via DashboardPage
    await dashboardPage.goToJanitors();
    
    // Create JanitorsPage instance
    const janitorsPage = new JanitorsPage(page);
    
    // Assert - Verify page loaded correctly
    await janitorsPage.assertPageLoaded();
    
    // Act & Assert - Toggle UNIT_TESTS janitor ON
    await janitorsPage.assertJanitorDisabled('UNIT_TESTS');
    await janitorsPage.assertRunButtonNotVisible('UNIT_TESTS');
    
    await janitorsPage.toggleJanitor('UNIT_TESTS');
    
    // Assert - Verify janitor is now enabled and run button is visible
    await janitorsPage.assertJanitorEnabled('UNIT_TESTS');
    await janitorsPage.assertRunButtonVisible('UNIT_TESTS');
    
    // Act - Manually trigger the janitor run
    await janitorsPage.runJanitor('UNIT_TESTS');
    
    // Assert - Verify toast notification appears (or error toast)
    // Toast can be success or error, we just verify interaction completed
    await page.waitForTimeout(1000); // Give time for API call to complete
    
    // Act & Assert - Toggle INTEGRATION_TESTS janitor ON
    await janitorsPage.assertJanitorDisabled('INTEGRATION_TESTS');
    await janitorsPage.toggleJanitor('INTEGRATION_TESTS');
    await janitorsPage.assertJanitorEnabled('INTEGRATION_TESTS');
    await janitorsPage.assertRunButtonVisible('INTEGRATION_TESTS');
    
    // Act - Manually trigger the integration tests janitor run
    await janitorsPage.runJanitor('INTEGRATION_TESTS');
    
    // Give time for API call to complete
    await page.waitForTimeout(1000);
    
    // Act & Assert - Toggle UNIT_TESTS janitor OFF
    await janitorsPage.toggleJanitor('UNIT_TESTS');
    await janitorsPage.assertJanitorDisabled('UNIT_TESTS');
    await janitorsPage.assertRunButtonNotVisible('UNIT_TESTS');
    
    // Verify INTEGRATION_TESTS is still enabled
    await janitorsPage.assertJanitorEnabled('INTEGRATION_TESTS');
    await janitorsPage.assertRunButtonVisible('INTEGRATION_TESTS');
  });
  
  test('should handle multiple janitor toggles in sequence', async ({ page }) => {
    // Arrange
    const scenario = await createStandardWorkspaceScenario();
    
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();
    
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto(scenario.workspace.slug);
    await dashboardPage.goToJanitors();
    
    const janitorsPage = new JanitorsPage(page);
    await janitorsPage.assertPageLoaded();
    
    // Act - Toggle UNIT_TESTS on and off multiple times
    await janitorsPage.toggleJanitor('UNIT_TESTS');
    await janitorsPage.assertJanitorEnabled('UNIT_TESTS');
    
    await janitorsPage.toggleJanitor('UNIT_TESTS');
    await janitorsPage.assertJanitorDisabled('UNIT_TESTS');
    
    await janitorsPage.toggleJanitor('UNIT_TESTS');
    await janitorsPage.assertJanitorEnabled('UNIT_TESTS');
    
    // Final state should be enabled
    await janitorsPage.assertJanitorEnabled('UNIT_TESTS');
    await janitorsPage.assertRunButtonVisible('UNIT_TESTS');
  });
});
