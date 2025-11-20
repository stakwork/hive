import { test, expect } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, RoadmapPage } from '../../support/page-objects';

/**
 * E2E Test: Login and create a new feature
 * 
 * This test verifies the complete flow of:
 * 1. User authentication with mock provider
 * 2. Navigation to the roadmap page
 * 3. Creating a new feature
 * 4. Verification that the feature was created successfully
 */
test.describe('Login and create a new feature', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let roadmapPage: RoadmapPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    roadmapPage = new RoadmapPage(page);

    // Sign in with mock authentication
    await authPage.signInWithMock();
    
    // Get the workspace slug from the URL
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Wait for dashboard to load
    await dashboardPage.waitForLoad();
  });

  test('should successfully create a new feature after login', async ({ page }) => {
    // Navigate to roadmap page from dashboard
    await dashboardPage.goToRoadmap();
    
    // Wait for roadmap page to load
    await roadmapPage.waitForLoad();
    
    // Create a new feature with title "New Feature A"
    const featureId = await roadmapPage.createFeature('New Feature A');
    
    // Verify we navigated to the feature detail page
    expect(page.url()).toMatch(new RegExp(`/w/${workspaceSlug}/roadmap/${featureId}`));
    
    // Verify the URL contains a valid feature ID (cuid format)
    expect(featureId).toBeTruthy();
    expect(featureId.length).toBeGreaterThan(10);
  });
});
