/**
 * E2E Test: testing mock endpoint. coverage
 *
 * Tests navigation through Protect section pages:
 * - Capacity page
 * - Janitors page
 * - Testing page
 * - Recommendations page
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import {
  AuthPage,
  DashboardPage,
  CapacityPage,
  JanitorsPage,
  TestingPage,
  RecommendationsPage,
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { extractWorkspaceSlug } from '@/__tests__/e2e/support/helpers/navigation';

test.describe('testing mock endpoint. coverage', () => {
  test('should navigate through Protect section pages successfully', async ({ page }) => {
    // Setup: Create workspace scenario
    const scenario = await createStandardWorkspaceScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Initialize Page Objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const capacityPage = new CapacityPage(page);
    const janitorsPage = new JanitorsPage(page);
    const testingPage = new TestingPage(page);
    const recommendationsPage = new RecommendationsPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();
    await authPage.verifyAuthenticated();

    // Extract workspace slug from URL and navigate to correct workspace if needed
    const currentSlug = extractWorkspaceSlug(page);
    if (currentSlug !== workspaceSlug) {
      await dashboardPage.goto(workspaceSlug);
    }

    // Verify dashboard loads
    await dashboardPage.waitForLoad();
    expect(await dashboardPage.isLoaded()).toBe(true);

    // Step 2: Navigate to Capacity page
    await dashboardPage.goToCapacity();
    await capacityPage.waitForLoad();
    await capacityPage.verifyPageTitle();
    expect(await capacityPage.isLoaded()).toBe(true);

    // Step 3: Navigate to Janitors page (under Protect section)
    await dashboardPage.goToJanitors();
    await janitorsPage.waitForLoad();
    await janitorsPage.verifyPageTitle();
    expect(await janitorsPage.isLoaded()).toBe(true);

    // Step 4: Navigate to Testing page (under Protect section)
    await dashboardPage.goToTesting();
    await testingPage.waitForLoad();
    await testingPage.verifyPageTitle();
    expect(await testingPage.isLoaded()).toBe(true);

    // Step 5: Navigate to Recommendations page (under Protect section)
    await dashboardPage.goToRecommendations();
    await recommendationsPage.waitForLoad();
    await recommendationsPage.verifyPageTitle();
    expect(await recommendationsPage.isLoaded()).toBe(true);

    // Final verification: Ensure we're still on the correct workspace
    expect(extractWorkspaceSlug(page)).toBe(workspaceSlug);
  });
});
