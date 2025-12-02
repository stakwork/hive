/**
 * E2E Test: User Journey Mock Sample
 * 
 * This test demonstrates a user journey through the application:
 * - Authenticating with mock provider
 * - Navigating through the sidebar navigation
 * - Accessing the Plan (Roadmap) page
 * - Interacting with page elements
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, RoadmapPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { assertVisible, assertURLPattern } from '@/__tests__/e2e/support/helpers';

test.describe('User Journey Mock sample test', () => {
  test('should navigate through sidebar and interact with roadmap page', async ({ page }) => {
    // Arrange - Create test workspace and authenticate
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();
    
    // Wait for redirect to workspace dashboard
    await page.waitForURL(/\/w\/.*/, { timeout: 10000 });
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Verify we're on the dashboard
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.waitForLoad();
    
    // Act - Navigate through the sidebar
    // Expand Build section by clicking on it
    const buildButton = page.locator(selectors.navigation.buildSection);
    await assertVisible(page, selectors.navigation.buildSection);
    await buildButton.click();
    
    // Wait for section to expand
    await page.waitForTimeout(500);
    
    // Verify Tasks link is now visible (child of Build section)
    await assertVisible(page, selectors.navigation.tasksLink);
    
    // Navigate to Plan (Roadmap) page using the DashboardPage helper
    await dashboardPage.goToRoadmap();
    
    // Assert - Verify we're on the Plan page
    await assertURLPattern(page, /\/w\/.*\/plan/);
    
    // Initialize RoadmapPage and verify it loaded
    const roadmapPage = new RoadmapPage(page);
    await roadmapPage.waitForLoad();
    
    // Verify page title is visible
    await assertVisible(page, '[data-testid="page-title"]:has-text("Plan")');
    
    // Additional interactions with the page
    // Verify the feature input is visible (indicates page is ready for interaction)
    const featureInput = page.locator('input.border-input.flex.h-9').first();
    await expect(featureInput).toBeVisible({ timeout: 10000 });
    
    // Test clicking the Build button again to collapse it
    await buildButton.click();
    await page.waitForTimeout(500);
    
    // Expand it again
    await buildButton.click();
    await page.waitForTimeout(500);
    
    // Verify navigation persists - we should still be on the Plan page
    await assertURLPattern(page, /\/w\/.*\/plan/);
  });
});
