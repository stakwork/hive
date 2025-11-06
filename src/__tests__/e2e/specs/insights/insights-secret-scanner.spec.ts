import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, InsightsPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * Insights page navigation and Secret Scanner verification tests
 * Tests user journey for navigating to Insights and verifying Secret Scanner card
 */
test.describe('Insights - Secret Scanner Verification', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let insightsPage: InsightsPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    insightsPage = new InsightsPage(page);

    // Authenticate and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test('should navigate to insights page via sidebar', async ({ page }) => {
    // Click the insights navigation link
    await page.locator(selectors.navigation.insightsLink).click();

    // Wait for URL to change to insights page
    await page.waitForURL(/\/w\/.*\/insights/, { timeout: 10000 });

    // Verify we're on the insights page
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
    expect(page.url()).toContain('/insights');
  });

  test('should display insights page title', async ({ page }) => {
    // Navigate to insights page
    await insightsPage.goto(workspaceSlug);

    // Verify page title is visible
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
  });

  test('should display Secret Scanner card on insights page', async ({ page }) => {
    // Navigate to insights page
    await insightsPage.goto(workspaceSlug);

    // Scroll to Secret Scanner card
    await insightsPage.scrollToSecretScanner();

    // Verify Secret Scanner card is visible
    const isCardVisible = await insightsPage.isSecretScannerCardVisible();
    expect(isCardVisible).toBe(true);
  });

  test('should display Secret Scanner title with correct text', async ({ page }) => {
    // Navigate to insights page
    await insightsPage.goto(workspaceSlug);

    // Scroll to Secret Scanner card
    await insightsPage.scrollToSecretScanner();

    // Verify Secret Scanner title is visible and contains correct text
    await insightsPage.assertSecretScannerTitle();
  });

  test('should display Run Scan button on Secret Scanner card', async ({ page }) => {
    // Navigate to insights page
    await insightsPage.goto(workspaceSlug);

    // Scroll to Secret Scanner card
    await insightsPage.scrollToSecretScanner();

    // Verify Run Scan button is visible
    await expect(page.locator(selectors.insights.secretScannerRunButton)).toBeVisible();
  });

  test('should complete full user journey: dashboard -> insights -> secret scanner', async ({ page }) => {
    // Starting from dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();

    // Navigate to insights via sidebar
    await insightsPage.navigateViaNavigation();

    // Verify we're on insights page
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();

    // Scroll to and verify Secret Scanner card
    await insightsPage.scrollToSecretScanner();
    await insightsPage.assertSecretScannerVisible();

    // Verify Secret Scanner title contains correct text
    const secretScannerCard = insightsPage.getSecretScannerCard();
    await expect(secretScannerCard).toContainText('Secret Scanner');

    // Verify Run Scan button is present (the actionable button from recorded test)
    await expect(page.locator(selectors.insights.secretScannerRunButton)).toBeVisible();
  });
});
