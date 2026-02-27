import { test, expect } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * Dashboard smoke tests
 * Quick sanity checks that core dashboard components are visible
 */
test.describe('Dashboard Smoke Tests', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data with standard workspace scenario
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);

    // Sign in and navigate to the specific workspace
    await authPage.goto();
    await authPage.signInWithMock();
    
    // Navigate to the specific workspace created for this test
    await page.goto(`/w/${workspaceSlug}`);
    await dashboardPage.waitForLoad();
  });

  test('should display code graph', async ({ page }) => {
    // Dashboard should show the graph component
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });
  });

  test('should navigate to tasks page', async ({ page }) => {
    await dashboardPage.goToTasks();
    await expect(page.locator(selectors.pageTitle.tasks)).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await expect(page.locator(selectors.navigation.settingsButton)).toBeVisible();
    await dashboardPage.goToSettings();
  });

  test('should persist workspace context after page reload', async ({ page }) => {
    await dashboardPage.reload();
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
    // Verify we're still on the dashboard page (graph is visible)
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });
  });
});
