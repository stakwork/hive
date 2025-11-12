import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';
import { AuthPage, TasksPage, RoadmapPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

/**
 * E2E Test: Roadmap Navigation from Tasks
 * 
 * Verifies that users can navigate from the Tasks page to the Roadmap page
 * using the sidebar navigation and that the Features section loads correctly.
 */
test.describe('Roadmap Navigation', () => {
  test('should navigate from Tasks to Roadmap via sidebar', async ({ page }) => {
    // Setup: Create workspace and user
    const scenario = await createStandardWorkspaceScenario();
    
    // Setup: Authenticate as workspace owner
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();
    
    // Navigate to tasks page
    const tasksPage = new TasksPage(page);
    await tasksPage.goto(scenario.workspace.slug);
    
    // Verify we're on the tasks page
    await tasksPage.verifyOnTasksPage();
    
    // Navigate to roadmap using sidebar navigation
    await tasksPage.navigateToRoadmap();
    
    // Wait for roadmap page to load
    const roadmapPage = new RoadmapPage(page);
    await roadmapPage.waitForLoad();
    
    // Assert: Verify Features section is visible
    const featuresSection = page.locator(selectors.roadmap.featuresSection);
    await expect(featuresSection).toBeVisible({ timeout: 10000 });
    
    // Assert: Verify "Features" title is present in the section
    await expect(featuresSection).toContainText('Features');
  });
});
