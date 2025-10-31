/**
 * E2E Test: Workspace Navigation User Journey
 * 
 * Tests the complete navigation flow from authentication through workspace
 * to Tasks page and then to Roadmap page. Validates that each page loads
 * correctly and navigation is smooth.
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { expect } from '@playwright/test';
import { 
  AuthPage, 
  DashboardPage, 
  TasksPage,
  RoadmapPage 
} from '@/__tests__/e2e/support/page-objects';

test.describe('Workspace Navigation User Journey', () => {
  test('should navigate from auth to workspace to tasks to roadmap', async ({ page }) => {
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);
    const roadmapPage = new RoadmapPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();
    
    // Get workspace slug for reference
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    expect(workspaceSlug).toBeTruthy();

    // Step 2: Verify we're on the workspace dashboard
    await dashboardPage.waitForLoad();
    expect(page.url()).toContain(`/w/${workspaceSlug}`);

    // Step 3: Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();
    await tasksPage.verifyOnTasksPage();
    expect(page.url()).toContain(`/w/${workspaceSlug}/tasks`);

    // Step 4: Navigate to Roadmap page
    await dashboardPage.goToRoadmap();
    await roadmapPage.waitForLoad();
    expect(page.url()).toContain(`/w/${workspaceSlug}/roadmap`);

    // Verify page title is visible
    await expect(page.locator('[data-testid="page-title"]:has-text("Roadmap")')).toBeVisible();
  });
});
