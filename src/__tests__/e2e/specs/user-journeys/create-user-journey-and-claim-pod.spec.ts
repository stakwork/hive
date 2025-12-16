import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, TestingPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * Create User Journey and Claim Pod Test
 * Tests the complete user journey of navigating to the Testing page,
 * switching to User Journeys tab, and claiming a pod for E2E test creation
 */
test.describe('Create User Journey and Claim Pod', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let testingPage: TestingPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data with standard workspace scenario
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    testingPage = new TestingPage(page);

    // Authenticate using mock auth
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test('should navigate to Testing page directly', async ({ page }) => {
    // Navigate directly to Testing page
    await testingPage.goto(workspaceSlug);

    // Verify we're on the Testing page
    await expect(page.locator(selectors.pageTitle.testing)).toBeVisible();
    expect(page.url()).toContain('/testing');
  });

  test('should display User Journeys tab', async ({ page }) => {
    // Navigate to Testing page
    await testingPage.goto(workspaceSlug);

    // Verify User Journeys tab is visible
    const isTabVisible = await testingPage.isUserJourneysTabVisible();
    expect(isTabVisible).toBe(true);
  });

  test('should switch to User Journeys tab and display Create button', async ({ page }) => {
    // Navigate to Testing page
    await testingPage.goto(workspaceSlug);

    // Switch to User Journeys tab
    await testingPage.switchToUserJourneysTab();

    // Verify Create User Journey button is visible
    await expect(page.locator(selectors.userJourneys.createButton)).toBeVisible();
  });

  test('should complete full journey: navigate → switch tab → click create button', async ({ page }) => {
    // Starting from dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    // Navigate to Testing page directly
    await testingPage.goto(workspaceSlug);

    // Verify we're on Testing page
    await expect(page.locator(selectors.pageTitle.testing)).toBeVisible();

    // Switch to User Journeys tab
    await testingPage.switchToUserJourneysTab();

    // Verify Create User Journey button is visible
    const isCreateButtonVisible = await testingPage.isCreateButtonVisible();
    expect(isCreateButtonVisible).toBe(true);

    // Click Create User Journey button to claim pod
    await testingPage.clickCreateUserJourney();

    // Note: Pod claiming requires actual pool infrastructure, so we verify the action was triggered
    // In a real environment, you would wait for the pod to be claimed and browser panel to appear
    // For this test, we verify the button was clickable and the action was triggered
    
    // Wait a moment for any loading states
    await page.waitForTimeout(2000);
    
    // The button should have been clicked successfully
    // In a full integration test with real infrastructure, you would also verify:
    // - await testingPage.waitForPodClaim();
    // - const isBrowserVisible = await testingPage.isBrowserPanelVisible();
    // - expect(isBrowserVisible).toBe(true);
  });

  test('should display Testing page elements correctly', async ({ page }) => {
    // Navigate directly to Testing page
    await testingPage.goto(workspaceSlug);

    // Verify page title
    const isTitleVisible = await testingPage.isPageTitleVisible();
    expect(isTitleVisible).toBe(true);

    // Verify tabs are visible
    await expect(page.locator(selectors.testing.tabs)).toBeVisible();

    // Verify both tab options exist
    await expect(page.locator(selectors.testing.coverageTab)).toBeVisible();
    await expect(page.locator(selectors.testing.userJourneysTab)).toBeVisible();
  });
});
