/**
 * E2E Test: Dashboard Card Action - Click Rerun Ingest Button
 * 
 * This test automates the click stream: open app -> click primary button in second card
 * The second card is RepositoryCard with the "Rerun Ingest" button
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';
import { assertVisible, assertContainsText } from '@/__tests__/e2e/support/helpers/assertions';

test.describe('Dashboard Card Actions', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
  });

  test('should click primary button in second card (Repository Card)', async ({ page }) => {
    // Authenticate using mock provider
    await authPage.signInWithMock();
    
    // Get workspace slug for navigation
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Navigate to dashboard and wait for it to load
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.waitForLoad();

    // Verify repository card is visible (second card)
    await assertVisible(page, selectors.dashboard.repoSection);

    // Click the primary button in the repository card (Rerun Ingest button)
    await dashboardPage.clickRepositoryCardRerunButton();

    // Assert expected outcome - toast message should appear
    // The "Rerun Ingest" button triggers code ingestion and shows a success toast
    await assertContainsText(page, 'text=/Ingest Started|Code ingestion has been started/i', 'Ingest Started');
  });

  test('should handle button disabled state during ingestion', async ({ page }) => {
    // Authenticate and navigate to dashboard
    await authPage.signInWithMock();
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.waitForLoad();

    // Verify repository card is visible
    await assertVisible(page, selectors.dashboard.repoSection);

    // Click the rerun button
    await dashboardPage.clickRepositoryCardRerunButton();

    // Verify button becomes disabled during processing
    const rerunButton = page.locator(selectors.dashboard.repoCardRerunButton);
    await expect(rerunButton).toBeDisabled();

    // Verify button text changes to "Ingesting..."
    await expect(rerunButton).toContainText('Ingesting...');
  });
});
