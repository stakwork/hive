import { test, expect } from '@playwright/test';
import { mockSignIn, getCurrentWorkspaceSlug } from '../../support/fixtures/auth';
import { DashboardPage } from '../../support/page-objects/DashboardPage';
import { InsightsPage } from '../../support/page-objects/InsightsPage';

test.describe('Insights Page Navigation', () => {
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test environment and login
    await mockSignIn(page);
    
    // Get the workspace slug from the URL after login
    workspaceSlug = getCurrentWorkspaceSlug(page);
  });

  test('should navigate to insights page and interact with settings', async ({ page }) => {
    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const insightsPage = new InsightsPage(page);
    
    // Navigate to the dashboard using DashboardPage goto method
    await dashboardPage.goto(workspaceSlug);
    
    // Click on the insights navigation item
    await page.click('[data-testid="nav-insights"]');
    
    // Verify insights page is loaded
    await insightsPage.waitForPageLoad();
    
    // Click settings button (which navigates to settings page instead of opening dropdown)
    await insightsPage.openSettingsDropdown();
    
    // Verify we navigated to the settings page by checking the URL
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/settings`));
    
    // Verify settings page content is visible
    await expect(page.locator('button:has-text("Update Workspace")')).toBeVisible();
  });
  
  test('should directly navigate to insights via URL', async ({ page }) => {
    // Initialize page objects
    const insightsPage = new InsightsPage(page);
    
    // Navigate directly to insights page using URL
    await insightsPage.navigateToInsights(workspaceSlug);
    
    // Verify page title is visible
    await expect(insightsPage.insightsTitle).toBeVisible();
    
    // Click settings button and verify navigation
    await insightsPage.openSettingsDropdown();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/settings`));
  });
});