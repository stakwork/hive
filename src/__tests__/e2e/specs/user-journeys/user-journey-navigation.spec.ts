import { test, expect } from '@playwright/test';
import { AuthPage, DashboardPage, UserJourneysPage } from '@/__tests__/e2e/support/page-objects';
import { assertVisible } from '@/__tests__/e2e/support/helpers/assertions';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

/**
 * E2E Test: User Journey Navigation
 * 
 * Tests the complete user journey from authentication through navigation to the User Journeys section.
 * 
 * Flow:
 * 1. Mock sign-in using AuthPage
 * 2. Navigate to workspace dashboard
 * 3. Navigate to User Journeys page via navigation menu
 * 4. Verify User Journeys page loads correctly
 */
test.describe('User Journey Navigation', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let userJourneysPage: UserJourneysPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    userJourneysPage = new UserJourneysPage(page);

    // Sign in and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.waitForLoad();
  });

  test('should navigate from sign-in to User Journeys page', async ({ page }) => {
    // Step 1: Verify User Journeys navigation link is visible in sidebar
    await assertVisible(page, selectors.navigation.userJourneysLink);

    // Step 2: Navigate to User Journeys via navigation menu
    await dashboardPage.goToUserJourneys();

    // Step 3: Verify User Journeys page loaded
    await userJourneysPage.waitForLoad();
    await userJourneysPage.verifyPageTitle();

    // Step 4: Verify we're on the correct URL
    await page.waitForURL(/\/w\/.*\/user-journeys/, { timeout: 5000 });
    
    // Step 5: Verify E2E Tests section is visible
    await userJourneysPage.verifyE2ETestsSection();
  });

  test('should navigate directly to User Journeys page with URL', async ({ page }) => {
    // Navigate directly to User Journeys page using URL
    await userJourneysPage.goto(workspaceSlug);

    // Verify page loads correctly
    await userJourneysPage.verifyPageTitle();
    await userJourneysPage.verifyE2ETestsSection();
  });
});
