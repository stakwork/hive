import { test, expect } from '@playwright/test';

test('User can create a new task after signing in', async ({ page }) => {
  // Navigate to the homepage
  await page.goto('http://localhost:3000');
  
  // Wait for page to load completely
  await page.waitForLoadState('networkidle');

  // Set viewport size
  await page.setViewportSize({ 
    width: 1063, 
    height: 549 
  });

  // Verify welcome message is displayed
  const welcomeHeading = page.locator('div.text-2xl.font-bold');
  await expect(welcomeHeading).toBeVisible();
  await expect(page.locator('div.grid.auto-rows-min.items-start')).toContainText('Welcome to Hive');

  // Sign in using mock authentication
  const signInButton = page.locator('[data-testid="mock-signin-button"]');
  await signInButton.click();
  
  // Wait for authentication to complete and dashboard to load
  await page.waitForSelector('button:has-text("Tasks")');

  // Navigate to Tasks section
  const tasksButton = page.locator('button:has-text("Tasks")');
  await tasksButton.click();
  
  // Verify we're on the Tasks page
  const tasksHeading = page.locator('h1.text-3xl.font-bold.text-foreground');
  await expect(tasksHeading).toContainText('Tasks');
  await expect(tasksHeading).toBeVisible();

  // Click on New Task button
  const newTaskButton = page.locator('button:has-text("New Task")');
  await newTaskButton.click();
  
  // Wait for the task input to appear
  const taskInput = page.locator('textarea.border-input.flex.field-sizing-content');
  await taskInput.waitFor({ state: 'visible' });
  
  // Enter task description
  await taskInput.fill('This is a new task!');
  
  // Submit the new task
  const submitButton = page.locator('button.inline-flex.items-center.justify-center');
  await submitButton.click();
  
  // Wait for task to appear in the list and verify its content
  const taskContent = page.locator('div.flex.h-full.min-w-0');
  await expect(taskContent).toBeVisible();
  await expect(taskContent).toContainText('This is a new task!');
});