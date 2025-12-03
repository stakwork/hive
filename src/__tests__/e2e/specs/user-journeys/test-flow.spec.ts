import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { AuthPage, DashboardPage, TasksPage, LearnPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

/**
 * E2E Test: test-flow
 * 
 * Tests the basic navigation flow through the workspace:
 * 1. Sign in with mock authentication
 * 2. Navigate to the workspace dashboard
 * 3. Navigate to Tasks page and verify empty state
 * 4. Navigate to Learn page and verify Learning Assistant
 */
test.describe('test-flow', () => {
  test('should navigate through workspace and verify Tasks and Learn pages', async ({ page }) => {
    // Setup: Create workspace scenario
    const scenario = await createStandardWorkspaceScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);
    const learnPage = new LearnPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.goto();
    await authPage.signInWithMock();

    // Step 2: Navigate to workspace dashboard
    await dashboardPage.goto(workspace.slug);
    await dashboardPage.waitForLoad();

    // Step 3: Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();

    // Step 4: Verify "No tasks created yet" message is visible
    await expect(page.locator(selectors.tasks.emptyStateText)).toBeVisible({ timeout: 10000 });

    // Step 5: Navigate to Learn page via sidebar
    await learnPage.navigateViaNavigation();
    await learnPage.waitForLoad();

    // Step 6: Verify "Learning Assistant" header is visible
    await learnPage.verifyLearningAssistant();
  });
});
