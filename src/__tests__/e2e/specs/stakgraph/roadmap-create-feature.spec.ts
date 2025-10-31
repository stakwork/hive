/**
 * E2E Test: Create Feature from Roadmap
 * 
 * Tests the user journey of creating a new feature from the roadmap page.
 * Verifies that a user can:
 * 1. Sign in with mock auth
 * 2. Navigate to the workspace roadmap
 * 3. Click "New feature" button
 * 4. Fill in the feature title
 * 5. Click "Create" button
 * 6. Verify navigation to feature detail page
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { 
  AuthPage, 
  DashboardPage, 
  RoadmapPage, 
  FeatureDetailPage 
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Create Feature from Roadmap', () => {
  test('should create a new feature from roadmap page', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const roadmapPage = new RoadmapPage(page);
    const featureDetailPage = new FeatureDetailPage(page);

    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Navigate to roadmap
    await page.locator(selectors.navigation.roadmapLink).click();
    await roadmapPage.waitForLoad();

    // Create a new feature
    const featureTitle = 'Make a feature';
    const featureId = await roadmapPage.createFeature(featureTitle);
    
    // Verify feature was created and navigation occurred
    expect(featureId).toBeTruthy();
    expect(page.url()).toContain(`/roadmap/${featureId}`);

    // Wait for feature detail page to load
    await featureDetailPage.waitForLoad();

    // Verify we're on the feature detail page
    await expect(page).toHaveURL(new RegExp(`/w/${scenario.workspace.slug}/roadmap/${featureId}`));
  });
});
