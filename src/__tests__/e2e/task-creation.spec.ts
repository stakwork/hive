import { test, expect } from '@playwright/test';

test('User can create a new task', async ({ page }) => {
  // Navigate to the application
  await page.goto('http://localhost:3000');
  
  // Wait for page to load completely
  await page.waitForLoadState('networkidle');
  
  // Set viewport size to match typical desktop dimensions
  await page.setViewportSize({ 
    width: 1078, 
    height: 549 
  });
  
  // Verify welcome text is displayed
  await expect(page.locator('div.text-2xl.font-bold')).toContainText('Welcome to Hive');
  
  // Sign in using mock authentication
  await page.click('[data-testid="mock-signin-button"]');
  
  // Wait for authentication to complete and dashboard to load
  await page.waitForSelector('button:has-text("Tasks")', { state: 'visible' });
  
  // Navigate to Tasks page
  await page.click('button:has-text("Tasks")');
  
  // Verify we're on the Tasks page
  await expect(page.locator('h1.text-3xl.font-bold.text-foreground')).toContainText('Tasks');
  
  // Wait for the tasks list to be fully loaded
  await page.waitForSelector('button:has-text("New Task")', { state: 'visible' });
  
  // Click on New Task button to create a task
  await page.click('button:has-text("New Task")');
  
  // Wait for the task creation form to appear
  await page.waitForSelector('textarea.border-input.flex', { state: 'visible' });
  
  // Enter task details
  await page.fill('textarea.border-input.flex.field-sizing-content', 'This is a new task!');
  
  // Submit the new task
  await page.click('button.inline-flex.items-center.justify-center');
  
  // Wait for task to be saved and displayed in the list
  await page.waitForSelector('div.flex.h-full.min-w-0:has-text("This is a new task!")', { state: 'visible' });
  
  // Verify the task was created successfully
  await expect(page.locator('div.flex.h-full.min-w-0')).toContainText('This is a new task!');
});