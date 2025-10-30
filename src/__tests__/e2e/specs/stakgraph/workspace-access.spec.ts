/**
 * E2E Test: Workspace Access via Mock Auth
 * 
 * Tests that a user can authenticate with mock provider and access their workspace,
 * verifying the complete authentication and workspace navigation flow.
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { expect } from '@playwright/test';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Workspace Access via Mock Auth', () => {
  test('should authenticate and access workspace dashboard', async ({ page }) => {
    // Setup: Create workspace scenario with test data
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();

    // Step 2: Verify authentication succeeded
    await authPage.verifyAuthenticated();

    // Step 3: Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Step 4: Verify dashboard is fully loaded
    await dashboardPage.waitForLoad();

    // Step 5: Verify we're on the correct workspace
    const currentSlug = authPage.getCurrentWorkspaceSlug();
    expect(currentSlug).toBe(scenario.workspace.slug);

    // Step 6: Verify dashboard content is visible
    const isLoaded = await dashboardPage.isLoaded();
    expect(isLoaded).toBe(true);
  });
});
