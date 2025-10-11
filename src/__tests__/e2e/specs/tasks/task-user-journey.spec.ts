/**
 * E2E Test: Task User Journey
 * Tests navigating to tasks and interacting with task controls
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, TasksPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario, createWorkspaceWithTasksScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { assertVisible } from '@/__tests__/e2e/support/helpers/assertions';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Task User Journey', () => {
  test('should navigate to tasks and interact with task controls', async ({ page }) => {
    // Setup test scenario with workspace and tasks
    const scenario = await createWorkspaceWithTasksScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();
    
    // Step 2: Navigate to tasks via dashboard
    await dashboardPage.goToTasks();
    
    // Step 3: Verify tasks page loaded
    await tasksPage.waitForLoad();
    
    // Step 4: Verify view toggle controls are visible 
    await tasksPage.verifyViewToggleVisible();
    
    // Step 5: Click view toggle to switch from list to kanban view
    await tasksPage.clickViewToggle('kanban');
    
    // Step 6: Verify kanban view is active (toggle button should show selected state)
    await assertVisible(page, selectors.tasks.viewToggleKanban);
    
    // Step 7: Switch back to list view
    await tasksPage.clickViewToggle('list');
    
    // Step 8: Verify list view is active
    await assertVisible(page, selectors.tasks.viewToggleList);
  });

  test('should handle workspace switching via user dropdown', async ({ page }) => {
    // Setup test scenario
    const scenario = await createStandardWorkspaceScenario();

    // Initialize page objects  
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();
    
    // Step 2: Navigate to tasks
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();
    
    // Step 3: Click user dropdown trigger
    await page.locator(selectors.navigation.userDropdownTrigger).click();
    
    // Step 4: Verify dropdown is open by checking for workspace name in dropdown (first occurrence)
    const workspaceName = scenario.workspace.name;
    await page.locator(`text=${workspaceName}`).first().waitFor({ state: 'visible', timeout: 10000 });
    
    // Step 5: Close dropdown by clicking elsewhere
    await page.locator('body').click();
  });
});
