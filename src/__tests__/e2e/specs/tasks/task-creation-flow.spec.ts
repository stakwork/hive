import { test, expect } from "@/__tests__/e2e/support/fixtures/test-hooks";
import { AuthPage, DashboardPage, TasksPage } from "@/__tests__/e2e/support/page-objects";

/**
 * Task Creation Flow E2E Tests
 *
 * Tests the complete user journey for creating a task:
 * 1. Sign in with mock auth
 * 2. Navigate to Tasks page
 * 3. Click "New Task" button
 * 4. Fill task input and submit
 * 5. Verify task creation (URL change, task ID)
 * 6. Navigate back to Tasks list
 * 7. Verify task appears in the list
 */
test.describe("Task Creation Flow", () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let tasksPage: TasksPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    tasksPage = new TasksPage(page);

    // Sign in and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await dashboardPage.waitForLoad();
  });

  test("should create a new task and verify it appears in the task list", async ({ page }) => {
    // Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();

    // Verify we're on the tasks page
    await tasksPage.verifyOnTasksPage();

    // Click "New Task" button
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    if (!hasNewTaskButton) {
      // If no "New Task" button, workspace might need repository connection
      // Skip test or handle accordingly
      test.skip();
      return;
    }

    await tasksPage.clickNewTask();

    // Wait for task input to be ready
    await tasksPage.waitForTaskInput();

    // Create task with a unique title
    const taskTitle = `E2E Test Task - ${Date.now()}`;
    const taskId = await tasksPage.createTask(taskTitle);

    // Verify task was created (URL changed with task ID)
    expect(taskId).toBeTruthy();
    expect(page.url()).toContain(taskId);

    // Navigate back to Tasks list
    await tasksPage.goto(workspaceSlug);

    // Verify task appears in the list
    await tasksPage.verifyTaskInList(taskTitle);
  });

  test("should navigate to task details when clicking on a task in the list", async ({ page }) => {
    // Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();

    // Skip if no New Task button (repository not connected)
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    if (!hasNewTaskButton) {
      test.skip();
      return;
    }

    // Create a task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    const taskTitle = `E2E Clickable Task - ${Date.now()}`;
    const taskId = await tasksPage.createTask(taskTitle);

    // Navigate back to Tasks list
    await tasksPage.goto(workspaceSlug);

    // Click on the task in the list
    await tasksPage.clickTask(taskTitle);

    // Verify we navigated to the task detail page
    expect(page.url()).toContain(taskId);
  });

  test("should show task count after creating multiple tasks", async ({ page }) => {
    // Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();

    // Skip if no New Task button
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    if (!hasNewTaskButton) {
      test.skip();
      return;
    }

    // Get initial task count
    const initialCount = await tasksPage.getTaskCount();

    // Create first task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    const task1Title = `E2E Multi Task 1 - ${Date.now()}`;
    await tasksPage.createTask(task1Title);

    // Navigate back to list
    await tasksPage.goto(workspaceSlug);

    // Verify first task appears
    await tasksPage.verifyTaskInList(task1Title);

    // Create second task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    const task2Title = `E2E Multi Task 2 - ${Date.now()}`;
    await tasksPage.createTask(task2Title);

    // Navigate back to list
    await tasksPage.goto(workspaceSlug);

    // Verify both tasks appear
    await tasksPage.verifyTaskInList(task1Title);
    await tasksPage.verifyTaskInList(task2Title);

    // Verify task count increased by 2
    const finalCount = await tasksPage.getTaskCount();
    expect(finalCount).toBeGreaterThanOrEqual(initialCount + 2);
  });

  test("should persist task after page reload", async ({ page }) => {
    // Navigate to Tasks page
    await dashboardPage.goToTasks();
    await tasksPage.waitForLoad();

    // Skip if no New Task button
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    if (!hasNewTaskButton) {
      test.skip();
      return;
    }

    // Create a task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    const taskTitle = `E2E Persist Task - ${Date.now()}`;
    const taskId = await tasksPage.createTask(taskTitle);

    // Reload the page
    await page.reload();

    // Verify we're still on the same task page
    expect(page.url()).toContain(taskId);

    // Navigate to tasks list and verify task persists
    await tasksPage.goto(workspaceSlug);
    await tasksPage.verifyTaskInList(taskTitle);
  });
});
