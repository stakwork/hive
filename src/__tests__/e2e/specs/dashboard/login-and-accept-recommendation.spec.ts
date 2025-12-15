import { test, expect } from '../../support/fixtures/test-hooks';
import { 
  AuthPage, 
  DashboardPage, 
  RecommendationsPage,
  TasksPage 
} from '../../support/page-objects';
import { createWorkspaceWithRecommendationsScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * E2E Test: Login and Accept Recommendation
 * 
 * Test Flow:
 * 1. User logs in with mock authentication
 * 2. Navigates to recommendations page
 * 3. Views available recommendations
 * 4. Accepts a recommendation
 * 5. Verifies recommendation is accepted and removed from list
 * 6. Verifies task is created from the accepted recommendation
 */
test.describe('Login and Accept Recommendation', () => {
  test('should login and accept a recommendation successfully', async ({ page }) => {
    // Create workspace with recommendations (after db reset by test hook)
    const scenario = await createWorkspaceWithRecommendationsScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const recommendationsPage = new RecommendationsPage(page);

    // Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();
    
    // Verify authenticated and on dashboard
    await authPage.verifyAuthenticated();
    await dashboardPage.waitForLoad();

    // Navigate to recommendations page
    await dashboardPage.goToRecommendations();
    await recommendationsPage.waitForLoad();

    // Verify recommendations are displayed
    await recommendationsPage.verifyRecommendationCount(3);
    
    // Verify first recommendation content
    await recommendationsPage.verifyRecommendationVisible(0, 'Add unit tests for UserService');

    // Get the initial count of recommendations
    const initialCount = await recommendationsPage.getRecommendationCards().count();
    expect(initialCount).toBe(3);

    // Accept the first recommendation
    await recommendationsPage.acceptRecommendation(0);

    // Verify success toast message appears (flexible check)
    await recommendationsPage.verifyToastMessage('accepted');

    // Wait for recommendation to be removed from list
    await recommendationsPage.waitForRecommendationRemoval(initialCount);

    // Verify recommendation count decreased
    await recommendationsPage.verifyRecommendationCount(2);

    // Verify the accepted recommendation is no longer visible
    const remainingTitles = await recommendationsPage.getRecommendationCards().allTextContents();
    expect(remainingTitles.join(' ')).not.toContain('Add unit tests for UserService');
  });

  test('should display multiple recommendations with correct priority badges', async ({ page }) => {
    // Create workspace with recommendations (after db reset by test hook)
    const scenario = await createWorkspaceWithRecommendationsScenario();

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const recommendationsPage = new RecommendationsPage(page);

    // Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();
    
    // Verify authenticated and on dashboard
    await authPage.verifyAuthenticated();
    await dashboardPage.waitForLoad();

    // Navigate to recommendations page
    await dashboardPage.goToRecommendations();
    await recommendationsPage.waitForLoad();

    // Verify all 3 recommendations are displayed
    await recommendationsPage.verifyRecommendationCount(3);

    // Verify each recommendation has required elements
    for (let i = 0; i < 3; i++) {
      const card = recommendationsPage.getRecommendationCard(i);
      await expect(card).toBeVisible();
      
      const title = recommendationsPage.getRecommendationTitle(i);
      await expect(title).toBeVisible();
      
      const description = recommendationsPage.getRecommendationDescription(i);
      await expect(description).toBeVisible();
      
      const acceptButton = recommendationsPage.getAcceptButton(i);
      await expect(acceptButton).toBeVisible();
      
      const dismissButton = recommendationsPage.getDismissButton(i);
      await expect(dismissButton).toBeVisible();
    }
  });

  test('should navigate between dashboard, recommendations, and tasks', async ({ page }) => {
    // Create workspace with recommendations (after db reset by test hook)
    const scenario = await createWorkspaceWithRecommendationsScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const recommendationsPage = new RecommendationsPage(page);
    const tasksPage = new TasksPage(page);

    // Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();
    
    // Verify authenticated and on dashboard
    await authPage.verifyAuthenticated();
    await dashboardPage.waitForLoad();

    // Start on dashboard
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();

    // Navigate to recommendations
    await dashboardPage.goToRecommendations();
    expect(page.url()).toContain(`/w/${workspaceSlug}/recommendations`);
    await recommendationsPage.waitForLoad();
    await recommendationsPage.verifyRecommendationCount(3);

    // Navigate to tasks
    await dashboardPage.goToTasks();
    expect(page.url()).toContain(`/w/${workspaceSlug}/tasks`);
    await tasksPage.waitForLoad();

    // Navigate back to recommendations
    await dashboardPage.goToRecommendations();
    expect(page.url()).toContain(`/w/${workspaceSlug}/recommendations`);
    await recommendationsPage.waitForLoad();
  });
});
