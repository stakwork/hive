import { test, expect } from '../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, TasksPage } from '../support/page-objects';
import { createStandardWorkspaceScenario } from '../support/fixtures/e2e-scenarios';

/**
 * Debug Test: Check what's actually on the page
 */
test.describe('Debug Task Flow', () => {
  test('debug: what is on the tasks page', async ({ page }) => {
    // Setup test scenario with workspace
    const scenario = await createStandardWorkspaceScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();
    
    // Step 2: Navigate to tasks page
    await dashboardPage.goToTasks();
    
    // Debug: Take screenshot and print page content
    await page.screenshot({ path: 'debug-tasks-page.png', fullPage: true });
    
    // Print page title and URL
    console.log('Page URL:', page.url());
    console.log('Page Title:', await page.title());
    
    // Print page content
    const bodyContent = await page.locator('body').innerHTML();
    console.log('Page HTML (first 500 chars):', bodyContent.substring(0, 500));
    
    // Check if we can find various elements
    const pageTitle = await page.locator('[data-testid="page-title"]').textContent().catch(() => 'NOT FOUND');
    console.log('Page title element:', pageTitle);
    
    const newTaskButton = await page.locator('button:has-text("New Task")').count();
    console.log('New Task buttons found:', newTaskButton);
    
    const allButtons = await page.locator('button').count();
    console.log('Total buttons found:', allButtons);
    
    // List all button text
    const buttonTexts = await page.locator('button').allInnerTexts();
    console.log('All button texts:', buttonTexts);
    
    // Check for error messages
    const errorElements = await page.locator('text=/error|failed|not found/i').count();
    console.log('Error messages found:', errorElements);
    
    // Force test to pass for debugging
    expect(true).toBe(true);
  });
});
