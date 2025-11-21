import { test, expect } from "@playwright/test";
import { AuthPage, DashboardPage } from "../../support/page-objects";
import { selectors } from "../../support/fixtures/selectors";

/**
 * Dashboard smoke tests
 * Quick sanity checks that core dashboard components are visible
 */
test.describe("Dashboard Smoke Tests", () => {
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

  test("should display code graph", async ({ page }) => {
    // Dashboard should show the graph component
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();
  });

  test("should navigate to tasks page", async ({ page }) => {
    await dashboardPage.goToTasks();
    await expect(page.locator(selectors.pageTitle.tasks)).toBeVisible();
  });

  test("should navigate to settings page", async ({ page }) => {
    await expect(page.locator(selectors.navigation.settingsButton)).toBeVisible();
    await dashboardPage.goToSettings();
  });

  test("should persist workspace context after page reload", async ({ page }) => {
    await dashboardPage.reload();
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
    // Verify we're still on the dashboard page (graph is visible)
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();
  });
});
