/**
 * E2E Test: Capacity Page Smoke Test
 * 
 * Tests basic capacity page functionality:
 * - User authentication
 * - Navigation to capacity page
 * - Page load and title verification
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, CapacityPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Capacity Page Smoke Test', () => {
  test('should login, navigate to capacity page, and verify page loads correctly', async ({ page }) => {
    // Setup: Create test workspace and user
    const scenario = await createStandardWorkspaceScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const capacityPage = new CapacityPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();

    // Step 2: Verify we're on the dashboard
    await dashboardPage.waitForLoad();

    // Step 3: Navigate to capacity page via sidebar
    await capacityPage.navigateFromSidebar();

    // Step 4: Verify capacity page loaded correctly with proper title and URL
    await capacityPage.verifyTitle();
    await capacityPage.verifyURL(workspaceSlug);
  });
});
