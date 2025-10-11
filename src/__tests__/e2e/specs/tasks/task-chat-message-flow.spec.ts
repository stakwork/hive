/**
 * E2E Test: Task Chat Message Flow
 * Tests user journey from login to sending a chat message in a task
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, TasksPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Task Chat Message Flow', () => {
  test('user can create a new task and send chat message', async ({ page }) => {
    // Setup test data - use standard workspace scenario instead
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Step 1: Authenticate using mock sign-in
    await authPage.signInWithMock();
    await authPage.verifyAuthenticated();

    // Step 2: Navigate to workspace dashboard
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.goto(workspaceSlug);

    // Step 3: Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.verifyOnTasksPage();

    // Step 4: Create a new task instead of trying to select from empty list
    await tasksPage.clickNewTask();
    
    // Step 5: Create the task with a message
    const taskMessage = 'Create a test task for E2E chat testing';
    const taskId = await tasksPage.createTask(taskMessage);
    
    // Step 6: Verify we're on the task detail page
    await expect(page).toHaveURL(/\/w\/.*\/task\/[^\/]+$/, { timeout: 10000 });

    // Step 7: Send a chat message
    const chatMessage = 'E2E test message for task chat';
    await tasksPage.sendMessage(chatMessage);

    // Step 8: Assert the message appears in chat history
    await tasksPage.verifyMessageVisible(chatMessage);
  });

  test('user can send multiple chat messages in new task', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Authenticate and navigate to tasks
    await authPage.signInWithMock();
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.goToTasks();

    // Create a new task
    await tasksPage.clickNewTask();
    await tasksPage.createTask('Multi-message test task');

    // Send multiple messages
    const messages = [
      'First message in sequence',
      'Second message in sequence', 
      'Third message in sequence'
    ];

    for (const message of messages) {
      await tasksPage.sendMessage(message);
      await tasksPage.verifyMessageVisible(message);
    }

    // Verify all messages are visible
    for (const message of messages) {
      await expect(page.locator(`text=${message}`)).toBeVisible();
    }
  });
});
