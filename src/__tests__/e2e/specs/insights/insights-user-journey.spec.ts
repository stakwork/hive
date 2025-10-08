/**
 * E2E Test: Insights User Journey
 * 
 * Tests the complete user journey through the insights section:
 * - Mock authentication 
 * - Navigation to workspace insights
 * - Viewing and interacting with recommendations
 * - Performing actions on insights (accept/dismiss)
 */

import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, InsightsPage } from '../../support/page-objects';
import { createWorkspaceWithInsightsScenario } from '../../support/fixtures/e2e-scenarios';

test.describe('Insights User Journey', () => {
  test('should navigate to insights and interact with recommendations @smoke', async ({ page }) => {
    // Create test scenario with workspace and insights data
    const scenario = await createWorkspaceWithInsightsScenario(3);
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const insightsPage = new InsightsPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();

    // Step 2: Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);
    await dashboardPage.waitForLoad();

    // Step 3: Navigate to insights section
    await dashboardPage.goToInsights();
    await insightsPage.waitForLoad();

    // Step 4: Verify insights page loaded correctly
    await insightsPage.assertRecommendationsSectionVisible();
    
    // Step 5: Wait for recommendations to load and verify they exist
    await insightsPage.waitForRecommendationsLoad();
    const hasRecommendations = await insightsPage.hasRecommendations();
    expect(hasRecommendations).toBe(true);

    // Step 6: Verify we have the expected number of recommendations
    const recommendationCount = await insightsPage.getRecommendationCount();
    expect(recommendationCount).toBeGreaterThan(0);

    // Step 7: Test dismissing a recommendation
    const initialCount = await insightsPage.getRecommendationCount();
    await insightsPage.clickFirstRecommendationDismiss();
    
    // Step 8: Verify dismiss action feedback
    await insightsPage.assertToastMessage('dismissed');
    await insightsPage.waitForRecommendationUpdate();
    
    // Step 9: Verify recommendation count decreased (if there were multiple)
    const countAfterDismiss = await insightsPage.getRecommendationCount();
    if (initialCount > 1) {
      expect(countAfterDismiss).toBe(initialCount - 1);
    }

    // Step 10: Test accepting a recommendation (if there are any remaining)
    if (countAfterDismiss > 0) {
      await insightsPage.clickFirstRecommendationAccept();
      await insightsPage.assertToastMessage('accepted');
      await insightsPage.waitForRecommendationUpdate();
    }
  });

  test('should handle empty recommendations state', async ({ page }) => {
    // Create workspace without recommendations (count = 0)
    const scenario = await createWorkspaceWithInsightsScenario(0);
    
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const insightsPage = new InsightsPage(page);

    // Navigate to insights
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.goto(scenario.workspace.slug);
    await insightsPage.goto(scenario.workspace.slug);

    // Verify page loads and handles empty state
    await insightsPage.waitForLoad();
    await insightsPage.assertRecommendationsSectionVisible();
    await insightsPage.waitForRecommendationsLoad();
    
    const hasRecommendations = await insightsPage.hasRecommendations();
    expect(hasRecommendations).toBe(false);
  });

  test('should navigate directly to insights via URL', async ({ page }) => {
    // Test direct navigation to insights page
    const scenario = await createWorkspaceWithInsightsScenario(2);
    
    const authPage = new AuthPage(page);
    const insightsPage = new InsightsPage(page);

    // Sign in first
    await authPage.goto();
    await authPage.signInWithMock();

    // Navigate directly to insights
    await insightsPage.goto(scenario.workspace.slug);
    
    // Verify we're on the insights page and it loaded correctly
    await insightsPage.waitForLoad();
    await insightsPage.assertRecommendationsSectionVisible();
    await insightsPage.assertRecommendationsVisible();
  });
});
