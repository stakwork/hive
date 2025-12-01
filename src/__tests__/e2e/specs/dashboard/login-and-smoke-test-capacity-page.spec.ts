import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, CapacityPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

/**
 * Login and smoke test capacity page
 * Verifies user can navigate to capacity page and page displays correctly
 */
test.describe('Login and smoke test capacity page', () => {
  test('should login and navigate to capacity page', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug from the current URL (mock auth creates a workspace automatically)
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();

    // Verify we're on the dashboard
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.waitForLoad();

    // Act - Navigate to capacity page
    await dashboardPage.goToCapacity();

    // Assert - Verify capacity page is loaded and displays correct title
    const capacityPage = new CapacityPage(page);
    await capacityPage.waitForLoad();
    await expect(page.locator(selectors.pageTitle.capacity)).toBeVisible();
    await expect(page.locator(selectors.pageTitle.element)).toContainText('Capacity');
  });
});
