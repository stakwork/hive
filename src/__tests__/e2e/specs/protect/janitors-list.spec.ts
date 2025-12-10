import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, JanitorsPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Protect:Janitors:Check essential list is visible', () => {
  test('should display all essential janitors with their names and status badges', async ({ page }) => {
    // Arrange - Create test workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Wait for dashboard to fully load before navigating
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.waitForLoad();

    // Act - Navigate to Janitors page
    const janitorsPage = new JanitorsPage(page);
    await janitorsPage.navigateFromDashboard();

    // Assert - Verify page loaded
    await expect(page).toHaveURL(/\/w\/.*\/janitors/, { timeout: 10000 });

    // Assert - Verify all essential janitors are visible with their names and statuses
    await janitorsPage.verifyEssentialJanitorsVisible();

    // Additional verification - check specific janitor sections are visible
    await janitorsPage.verifyJanitorSectionVisible('task-coordinator');
    await janitorsPage.verifyJanitorSectionVisible('testing');
    await janitorsPage.verifyJanitorSectionVisible('security');
    await janitorsPage.verifyJanitorSectionVisible('maintainability');
  });
});
