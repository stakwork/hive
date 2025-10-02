import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';

/**
 * Dashboard Smoke Tests
 *
 * Quick sanity checks that core dashboard functionality works:
 * - Dashboard loads with main components visible
 * - Navigation to other pages works
 * - Workspace context persists after reload
 */
test.describe('Dashboard Smoke Tests', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);

    // Sign in and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.waitForLoad();
  });

  test('should load dashboard and display all core components', async ({ page }) => {
    // Verify we're on the dashboard
    await dashboardPage.verifyOnDashboardPage();

    // Verify all three main cards are visible
    await dashboardPage.verifyVMSectionVisible();
    await dashboardPage.verifyRepositoryCardVisible();
    await dashboardPage.verifyCoverageCardVisible();

    // Test navigation to tasks page
    await dashboardPage.goToTasks();
    expect(page.url()).toMatch(/\/w\/.*\/tasks/);
  });

  test('should persist workspace context after page reload', async ({ page }) => {
    await dashboardPage.reload();

    // Verify workspace slug is still in URL and dashboard loads
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
    await dashboardPage.verifyOnDashboardPage();
  });
});
