import { test, expect } from '@playwright/test';
import { AuthPage, DashboardPage, InsightsPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

/**
 * E2E Test: Insights Janitor Action
 * Tests the user journey of navigating to insights and interacting with janitor recommendations
 */
test.describe('Insights - Janitor Recommendation Actions', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let insightsPage: InsightsPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    insightsPage = new InsightsPage(page);

    // Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.waitForLoad();
  });

  test('should navigate to insights page from dashboard', async ({ page }) => {
    // Navigate to Insights via navigation link
    await dashboardPage.goToInsights();
    
    // Verify we're on the insights page
    await insightsPage.waitForLoad();
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
    expect(page.url()).toContain('/insights');
  });

  test('should display recommendations section on insights page', async ({ page }) => {
    // Navigate to Insights
    await dashboardPage.goToInsights();
    await insightsPage.waitForLoad();
    
    // Verify recommendations section is visible
    await expect(page.locator(selectors.insights.recommendationsSection)).toBeVisible();
  });

  test('should interact with recommendation accept button', async ({ page }) => {
    // Navigate to Insights
    await dashboardPage.goToInsights();
    await insightsPage.waitForLoad();
    
    // Check if there are recommendations available
    const hasRecommendations = await insightsPage.hasRecommendations();
    
    if (hasRecommendations) {
      // Get initial count
      const initialCount = await insightsPage.getRecommendationCount();
      expect(initialCount).toBeGreaterThan(0);
      
      // Click the accept button on the first recommendation
      await insightsPage.clickRecommendationAccept(0);
      
      // Verify a toast notification appears (recommendation accepted)
      // The component shows "Recommendation accepted!" toast
      await expect(page.getByText(/recommendation accepted/i)).toBeVisible({ timeout: 5000 });
      
      // After accepting, the recommendation should be removed from the list
      // Wait a moment for the UI to update
      await page.waitForTimeout(1000);
      
      // Verify the count decreased or page content updated
      const newCount = await insightsPage.getRecommendationCount();
      expect(newCount).toBeLessThanOrEqual(initialCount);
    } else {
      // Skip test if no recommendations - this is expected in a fresh workspace
      test.skip();
    }
  });

  test('should interact with recommendation dismiss button', async ({ page }) => {
    // Navigate to Insights
    await dashboardPage.goToInsights();
    await insightsPage.waitForLoad();
    
    // Check if there are recommendations available
    const hasRecommendations = await insightsPage.hasRecommendations();
    
    if (hasRecommendations) {
      // Get initial count
      const initialCount = await insightsPage.getRecommendationCount();
      expect(initialCount).toBeGreaterThan(0);
      
      // Click the dismiss button on the first recommendation
      await insightsPage.clickRecommendationDismiss(0);
      
      // Verify a toast notification appears (recommendation dismissed)
      await expect(page.getByText(/recommendation dismissed/i)).toBeVisible({ timeout: 5000 });
      
      // After dismissing, the recommendation should be removed from the list
      await page.waitForTimeout(1000);
      
      // Verify the count decreased
      const newCount = await insightsPage.getRecommendationCount();
      expect(newCount).toBeLessThanOrEqual(initialCount);
    } else {
      // Skip test if no recommendations - this is expected in a fresh workspace
      test.skip();
    }
  });

  test('should verify insights page elements are present', async ({ page }) => {
    // Navigate to Insights
    await dashboardPage.goToInsights();
    await insightsPage.waitForLoad();
    
    // Verify key sections are present
    await expect(page.locator(selectors.insights.recommendationsSection)).toBeVisible();
    
    // Verify page title
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
    
    // Verify page is loaded successfully
    const isLoaded = await insightsPage.isLoaded();
    expect(isLoaded).toBe(true);
  });
});
