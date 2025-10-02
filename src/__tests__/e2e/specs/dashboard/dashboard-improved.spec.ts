import { test, expect } from '@playwright/test';
import { AuthPage, DashboardPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

/**
 * Dashboard tests using Page Object Model
 */
test.describe('Dashboard (Improved)', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);

    // Sign in and get workspace slug
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
  });

  test('should load dashboard with main components', async ({ page }) => {
    await dashboardPage.waitForLoad();
    await dashboardPage.verifyDescription();

    // Verify page title using data-testid
    await expect(page.locator(selectors.pageTitle.dashboard)).toBeVisible();
  });

  test('should display VM config section', async () => {
    await dashboardPage.waitForLoad();
    const hasVMConfig = await dashboardPage.hasVMConfigSection();
    expect(hasVMConfig).toBeTruthy();
  });

  test('should display test coverage section', async ({ page }) => {
    await dashboardPage.waitForLoad();

    // Wait explicitly for the coverage card to appear
    const coverageCard = page.locator(selectors.dashboard.coverageSection);
    await expect(coverageCard).toBeVisible({ timeout: 15000 });
  });

  test('should have working navigation sidebar', async ({ page }) => {
    // Navigate to tasks using data-testid
    await page.locator(selectors.navigation.tasksLink).click();
    await page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
    await expect(page.locator(selectors.pageTitle.tasks)).toBeVisible();
  });

  test('should display workspace switcher', async () => {
    await dashboardPage.verifyWorkspaceSwitcher();
  });

  test('should have settings button accessible', async ({ page }) => {
    // Use data-testid for settings button
    await expect(page.locator(selectors.navigation.settingsButton)).toBeVisible();

    await dashboardPage.goToSettings();
    await expect(page.locator(selectors.pageTitle.settings)).toBeVisible();
  });

  test('should handle page reload gracefully', async ({ page }) => {
    await dashboardPage.reload();

    // Verify still on same workspace
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
  });
});
