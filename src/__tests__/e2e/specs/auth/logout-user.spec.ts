/**
 * E2E Test: Logout User
 * 
 * Tests the user logout flow including:
 * - User menu interaction
 * - Logout action
 * - Redirect to login page
 * - Session termination verification
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage } from '@/__tests__/e2e/support/page-objects/AuthPage';
import { DashboardPage } from '@/__tests__/e2e/support/page-objects/DashboardPage';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Logout User', () => {
  test('should successfully logout user and redirect to login page', async ({ page }) => {
    // Setup: Create standard workspace scenario
    const scenario = await createStandardWorkspaceScenario();

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();

    // Step 2: Verify user is authenticated and on workspace page
    await authPage.verifyAuthenticated();
    await dashboardPage.waitForLoad();

    // Step 3: Perform logout
    await authPage.logout();

    // Step 4: Verify user is logged out
    await authPage.verifyLoggedOut();

    // Step 5: Verify that attempting to access workspace redirects to login
    await page.goto(`http://localhost:3000/w/${scenario.workspace.slug}`);
    await authPage.verifyLoggedOut();
  });

  test('should logout user after navigating through multiple pages', async ({ page }) => {
    // Setup: Create standard workspace scenario
    const scenario = await createStandardWorkspaceScenario();

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();

    // Step 2: Navigate through various pages
    await dashboardPage.waitForLoad();
    
    // Navigate to Capacity
    await dashboardPage.goToCapacity();
    await expect(page).toHaveURL(/\/capacity/, { timeout: 10000 });

    // Navigate to Tasks
    await dashboardPage.goToTasks();
    await expect(page).toHaveURL(/\/tasks/, { timeout: 10000 });

    // Navigate to Settings
    await dashboardPage.goToSettings();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    // Step 3: Perform logout from settings page
    await authPage.logout();

    // Step 4: Verify user is logged out
    await authPage.verifyLoggedOut();

    // Step 5: Verify session is terminated
    await page.goto(`http://localhost:3000/w/${scenario.workspace.slug}/tasks`);
    await authPage.verifyLoggedOut();
  });
});
