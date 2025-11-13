/**
 * E2E Test: Learn Page Navigation
 * 
 * Tests the navigation to the Learn page and verifies the page loads correctly.
 * This test validates that users can successfully access the learning assistant
 * from the workspace dashboard.
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { 
  AuthPage, 
  DashboardPage, 
  LearnPage 
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Learn Page Navigation', () => {
  test('should navigate to learn page and verify it loads successfully', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const learnPage = new LearnPage(page);

    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Navigate to learn page using the navigation helper
    await dashboardPage.goToLearn();
    await learnPage.waitForLoad();

    // Verify we're on the correct URL
    await expect(page).toHaveURL(new RegExp(`/w/${scenario.workspace.slug}/learn`));

    // Verify the page title is correct
    await learnPage.verifyPageTitle();

    // Verify the welcome message is visible
    await learnPage.verifyWelcomeMessage();

    // Verify the chat area is loaded
    const isLoaded = await learnPage.isLoaded();
    expect(isLoaded).toBe(true);
  });

  test('should navigate directly to learn page via URL', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page object
    const learnPage = new LearnPage(page);

    // Navigate directly to learn page
    await learnPage.goto(scenario.workspace.slug);

    // Verify the page title is correct
    await learnPage.verifyPageTitle();

    // Verify the welcome message is visible
    await learnPage.verifyWelcomeMessage();

    // Verify the chat area is loaded
    const isLoaded = await learnPage.isLoaded();
    expect(isLoaded).toBe(true);
  });
});
