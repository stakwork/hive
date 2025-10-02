import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';

/**
 * Dashboard E2E Tests
 *
 * Tests the complete dashboard user experience:
 * 1. Dashboard loads with correct components
 * 2. VM Config section displays status
 * 3. Repository card shows repository info
 * 4. Test coverage card displays coverage stats
 * 5. Navigation works correctly
 * 6. Workspace context persists after reload
 */
test.describe('Dashboard', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);

    // Sign in and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.waitForLoad();
  });

  test('should display dashboard with all core sections', async () => {
    // Verify we're on the dashboard page
    await dashboardPage.verifyOnDashboardPage();

    // Verify all dashboard cards are visible
    await dashboardPage.verifyCardsGridVisible();
    await dashboardPage.verifyVMSectionVisible();
    await dashboardPage.verifyRepositoryCardVisible();
    await dashboardPage.verifyCoverageCardVisible();
  });

  test('should display VM config section with status', async () => {
    await dashboardPage.verifyVMSectionVisible();

    // Check if pool status is active or setup is needed
    const hasPoolStatus = await dashboardPage.hasPoolStatus();
    const hasFinishSetup = await dashboardPage.hasFinishSetupButton();

    // Either pool status or finish setup button should be visible
    expect(hasPoolStatus || hasFinishSetup).toBeTruthy();
  });

  test('should display repository card with repository info', async () => {
    await dashboardPage.verifyRepositoryCardVisible();

    // Repository card should either show repo info or GitHub link button
    const hasLinkGithub = await dashboardPage.hasLinkGithubButton();

    if (!hasLinkGithub) {
      // If no link button, repository info should be visible
      const repoName = await dashboardPage.getRepositoryName();
      expect(repoName).toBeTruthy();

      const repoStatus = await dashboardPage.getRepositoryStatus();
      expect(repoStatus).toBeTruthy();

      const repoBranch = await dashboardPage.getRepositoryBranch();
      expect(repoBranch).toBeTruthy();
    }
  });

  test('should display test coverage card', async () => {
    // Verify coverage card is visible (it may show stats, no data, or be loading)
    await dashboardPage.verifyCoverageCardVisible();
  });

  test('should navigate to tasks page from dashboard', async ({ page }) => {
    await dashboardPage.goToTasks();

    // Verify URL changed to tasks page
    expect(page.url()).toMatch(/\/w\/.*\/tasks/);
  });

  test('should navigate to settings page from dashboard', async ({ page }) => {
    await dashboardPage.goToSettings();

    // Verify we're on settings page
    expect(page.url()).toContain('/settings');
  });

  test('should persist workspace context after page reload', async ({ page }) => {
    // Reload the dashboard
    await dashboardPage.reload();

    // Verify workspace slug is still in URL
    expect(page.url()).toContain(`/w/${workspaceSlug}`);

    // Verify dashboard is still loaded correctly
    await dashboardPage.verifyOnDashboardPage();
  });

  test('should display repository status badge with correct variant', async () => {
    await dashboardPage.verifyRepositoryCardVisible();

    const hasLinkGithub = await dashboardPage.hasLinkGithubButton();

    if (!hasLinkGithub) {
      const repoStatus = await dashboardPage.getRepositoryStatus();

      // Status should be one of the expected values
      expect(['SYNCED', 'PENDING', 'FAILED']).toContain(repoStatus);
    }
  });
});
