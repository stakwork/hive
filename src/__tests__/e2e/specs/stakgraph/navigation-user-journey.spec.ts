/**
 * E2E Test: Stakgraph Navigation User Journey
 * 
 * Tests the complete flow of navigating to the stakgraph configuration page
 * from the workspace dashboard and interacting with the configuration interface.
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { expect } from '@playwright/test';
import { 
  AuthPage, 
  DashboardPage, 
  StakgraphPage 
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Stakgraph Navigation User Journey', () => {
  test('should navigate to stakgraph configuration and view pool settings', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const stakgraphPage = new StakgraphPage(page);

    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Navigate to stakgraph configuration page
    await dashboardPage.goToStakgraph();

    // Verify stakgraph page loaded
    await stakgraphPage.waitForLoad();
    expect(await stakgraphPage.isLoaded()).toBe(true);

    // Verify Pool Settings title is visible using the selector
    await expect(page.locator(selectors.stakgraph.poolSettingsTitle)).toBeVisible();

    // Verify Back to Settings button is visible using the selector
    await expect(page.locator(selectors.stakgraph.backToSettingsButton)).toBeVisible();
  });

  test('should navigate back to settings from stakgraph page', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const stakgraphPage = new StakgraphPage(page);

    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Navigate to stakgraph configuration page
    await dashboardPage.goToStakgraph();
    await stakgraphPage.waitForLoad();

    // Navigate back to settings
    await stakgraphPage.goBackToSettings();

    // Verify we're on the settings page
    await expect(page).toHaveURL(/\/w\/.*\/settings/);
  });
});
