import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, TasksPage } from '@/__tests__/e2e/support/page-objects';
import { assertVisible } from '@/__tests__/e2e/support/helpers';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

/**
 * Task Start Flow E2E Tests
 *
 * Tests the complete user journey for starting a new task:
 * 1. Sign in with mock auth
 * 2. Navigate to new task page
 * 3. Fill task start input
 * 4. Submit to create task
 * 5. Verify task creation and navigation to task detail page
 */
test.describe('Task Start Flow', () => {
  let authPage: AuthPage;
  let tasksPage: TasksPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    tasksPage = new TasksPage(page);

    // Sign in with mock auth
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
  });

  test('should create and start a new task with initial message', async ({ page }) => {
    // Navigate directly to new task page
    await tasksPage.goToNewTask(workspaceSlug);

    // Verify task start input is visible
    await assertVisible(page, selectors.tasks.taskStartInput);

    // Create task with initial message
    const taskMessage = 'first message';
    const taskId = await tasksPage.createTask(taskMessage);

    // Verify task was created
    expect(taskId).toBeTruthy();
    expect(taskId).not.toBe('new');

    // Verify URL changed to task detail page (not /task/new)
    expect(page.url()).toContain(`/w/${workspaceSlug}/task/${taskId}`);
    expect(page.url()).not.toContain('/task/new');

    // Verify we're on the task detail page with the message visible
    await tasksPage.verifyMessageVisible(taskMessage);
  });

  test('should navigate from tasks list to new task and create', async ({ page }) => {
    // Navigate to tasks page
    await tasksPage.goto(workspaceSlug);
    await tasksPage.waitForLoad();

    // Check if New Task button is available
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    if (!hasNewTaskButton) {
      // Skip test if workspace needs repository connection
      test.skip();
      return;
    }

    // Click "New Task" button
    await tasksPage.clickNewTask();

    // Verify we're on new task page
    expect(page.url()).toContain('/task/new');

    // Verify task start input is visible
    await tasksPage.waitForTaskInput();

    // Create task with message
    const taskMessage = `E2E Task - ${Date.now()}`;
    const taskId = await tasksPage.createTask(taskMessage);

    // Verify task creation
    expect(taskId).toBeTruthy();
    expect(page.url()).toContain(taskId);
    expect(page.url()).not.toContain('/task/new');

    // Verify message is visible on task page
    await tasksPage.verifyMessageVisible(taskMessage);

    // Navigate back to tasks list and verify task appears
    await tasksPage.goto(workspaceSlug);
    await tasksPage.verifyTaskInList(taskMessage);
  });

  test('should handle empty task input gracefully', async ({ page }) => {
    // Navigate to new task page
    await tasksPage.goToNewTask(workspaceSlug);

    // Verify task start input is visible
    await assertVisible(page, selectors.tasks.taskStartInput);

    // Verify submit button is disabled when input is empty
    const submitButton = page.locator(selectors.tasks.taskStartSubmit);
    await expect(submitButton).toBeDisabled();

    // Fill input with whitespace only
    const input = page.locator(selectors.tasks.taskStartInput);
    await input.fill('   ');

    // Submit button should still be disabled
    await expect(submitButton).toBeDisabled();

    // Verify we're still on new task page
    expect(page.url()).toContain('/task/new');
  });

  test('should focus task input on page load', async ({ page }) => {
    // Navigate to new task page
    await tasksPage.goToNewTask(workspaceSlug);

    // Verify task input has focus
    const input = page.locator(selectors.tasks.taskStartInput);
    await expect(input).toBeFocused();
  });

  test('should allow multiline input with Shift+Enter', async ({ page }) => {
    // Navigate to new task page
    await tasksPage.goToNewTask(workspaceSlug);

    // Fill multiline input using Shift+Enter
    const input = page.locator(selectors.tasks.taskStartInput);
    await input.focus();
    await input.type('Line 1');
    await page.keyboard.press('Shift+Enter');
    await input.type('Line 2');
    await page.keyboard.press('Shift+Enter');
    await input.type('Line 3');

    // Verify multiline content
    const value = await input.inputValue();
    expect(value).toContain('Line 1');
    expect(value).toContain('Line 2');
    expect(value).toContain('Line 3');
    expect(value.split('\n').length).toBe(3);

    // Submit with Enter key (not Shift+Enter)
    await page.keyboard.press('Enter');

    // Verify task was created
    await page.waitForURL((url) => {
      return url.pathname.includes('/task/') && !url.pathname.includes('/task/new');
    }, { timeout: 15000 });

    expect(page.url()).not.toContain('/task/new');
  });
});
