import { expect } from "@playwright/test";
import { test } from "../../support/fixtures/test-hooks";
import { AuthPage, CallsPage, DashboardPage } from "../../support/page-objects";
import { selectors } from "../../support/fixtures/selectors";
import { createStandardWorkspaceScenario } from "../../support/fixtures/e2e-scenarios";

/**
 * Calls page navigation and interaction tests
 * Tests user journey for navigating to and interacting with the Calls page
 */
test.describe("Calls Navigation", () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let callsPage: CallsPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    callsPage = new CallsPage(page);

    // Authenticate and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test("should navigate to calls page via sidebar", async ({ page }) => {
    // Expand Context section first if needed
    const contextButton = page.locator('[data-testid="nav-context"]');
    const callsLink = page.locator(selectors.navigation.callsLink);

    const isCallsVisible = await callsLink.isVisible().catch(() => false);
    if (!isCallsVisible) {
      await contextButton.click();
      await callsLink.waitFor({ state: "visible", timeout: 5000 });
    }

    // Click the calls navigation link
    await callsLink.click();

    // Wait for URL to change to calls page
    await page.waitForURL(/\/w\/.*\/calls/, { timeout: 10000 });

    // Verify we're on the calls page
    await expect(page.locator(selectors.pageTitle.calls)).toBeVisible();
    expect(page.url()).toContain("/calls");
  });

  test("should display calls page title", async ({ page }) => {
    // Navigate to calls page
    await callsPage.goto(workspaceSlug);

    // Verify page title is visible
    await expect(page.locator(selectors.pageTitle.calls)).toBeVisible();
  });

  test("should display Start Call button on calls page", async ({ page }) => {
    // Navigate to calls page
    await callsPage.goto(workspaceSlug);

    // Verify Start Call button is visible
    const isButtonVisible = await callsPage.isStartCallButtonVisible();
    expect(isButtonVisible).toBe(true);
  });

  test("should display Call Recordings card", async ({ page }) => {
    // Navigate to calls page
    await callsPage.goto(workspaceSlug);

    // Verify Call Recordings card is visible
    const isCardVisible = await callsPage.isCallRecordingsCardVisible();
    expect(isCardVisible).toBe(true);
  });

  test("should complete full user journey: dashboard -> calls -> interact", async ({ page }) => {
    // Starting from dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();

    // Navigate to calls via sidebar
    await callsPage.navigateViaNavigation();

    // Verify we're on calls page
    await expect(page.locator(selectors.pageTitle.calls)).toBeVisible();

    // Verify Start Call button is present (the actionable button from recorded test)
    await expect(page.locator(selectors.calls.startCallButton)).toBeVisible();
  });
});
