import { test, expect } from '@playwright/test';

/**
 * E2E test for user sign-in and task creation flow
 * Tests the critical path from login to creating the first task
 */
test('should allow user to sign in and create their first task', async ({ page }) => {
  // Navigate to the application
  await page.goto('http://localhost:3000');
  
  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Set consistent viewport size for testing
  await page.setViewportSize({ 
    width: 1028, 
    height: 549 
  });

  // Enter username in the mock login form
  const usernameField = page.locator('#mock-username');
  await usernameField.waitFor({ state: 'visible' });
  await usernameField.fill('ddd');

  // Click sign in button
  const signInButton = page.locator('[data-testid="mock-signin-button"]');
  await signInButton.waitFor({ state: 'visible' });
  await signInButton.click();

  // Verify successful navigation to dashboard
  const dashboardHeading = page.locator('h1.text-3xl.font-bold.text-foreground');
  await expect(dashboardHeading).toBeVisible();
  await expect(dashboardHeading).toContainText('Dashboard');

  // Click on "Create Your First Task" button
  const createTaskButton = page.locator('button:has-text("Create Your First Task")');
  await createTaskButton.waitFor({ state: 'visible' });
  await createTaskButton.click();

  // Wait for task creation form to appear
  const taskTextarea = page.locator('textarea.border-input.flex.field-sizing-content');
  await taskTextarea.waitFor({ state: 'visible' });
  
  // Complete task creation process by interacting with the task container
  // Note: These interactions could be improved with better selectors if available
  const taskContainer = page.locator('div.flex.flex-col.items-center');
  await taskContainer.waitFor({ state: 'visible' });
  await taskContainer.click();
  
  // Wait for task to be processed and verify expected heading is shown
  const buildSomethingHeading = page.locator('h1.text-4xl.font-bold.text-foreground');
  await expect(buildSomethingHeading).toBeVisible();
  await expect(buildSomethingHeading).toContainText('Build Something');
});