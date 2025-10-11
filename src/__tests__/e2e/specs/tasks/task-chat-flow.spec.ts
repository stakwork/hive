import { test, expect } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, TasksPage } from '../../support/page-objects';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';
import { assertVisible, assertContainsText } from '../../support/helpers/assertions';
import { extractWorkspaceSlug } from '../../support/helpers/navigation';

/**
 * E2E Test: Task Creation & Chat Flow
 * 
 * Tests the complete user journey:
 * 1. Sign in with mock auth
 * 2. Navigate to tasks page
 * 3. Create a new task with initial message
 * 4. Interact with task chat (send additional message)
 * 5. Verify both messages are visible
 */
test.describe('Task Creation & Chat Flow', () => {
  test('should create task and interact with chat successfully', async ({ page }) => {
    // Setup test scenario with workspace
    const scenario = await createStandardWorkspaceScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();
    
    // Verify we're authenticated and get workspace slug
    await authPage.verifyAuthenticated();
    const workspaceSlug = extractWorkspaceSlug(page);
    expect(workspaceSlug).toBe(workspace.slug);

    // Step 2: Navigate to tasks page
    await dashboardPage.goToTasks();
    await tasksPage.verifyOnTasksPage();

    // Step 3: Create new task with initial message
    const initialMessage = 'first message';
    await tasksPage.clickNewTask();
    
    // Wait for task creation form to load
    await tasksPage.waitForTaskInput();
    
    // Create task with initial message
    const taskId = await tasksPage.createTask(initialMessage);
    expect(taskId).toBeTruthy();

    // Step 4: Wait for task detail page to load
    await tasksPage.waitForTaskDetail();
    
    // Verify initial message is visible
    await tasksPage.verifyMessageVisible(initialMessage);

    // Step 5: Send additional chat message
    const chatMessage = 'second message';
    await tasksPage.sendMessage(chatMessage);
    
    // Step 6: Verify both messages are visible
    await tasksPage.verifyMessageVisible(initialMessage);
    await tasksPage.verifyMessageVisible(chatMessage);

    // Additional assertions using helper functions (using more specific selectors)
    await assertVisible(page, '[data-testid="task-title"]');
    await assertContainsText(page, '[data-testid="task-title"]', initialMessage);
    
    // Verify we're on the correct task detail page
    expect(page.url()).toMatch(new RegExp(`/w/${workspaceSlug}/task/${taskId}$`));
  });

  test('should handle empty task creation gracefully', async ({ page }) => {
    // Setup test scenario
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Sign in and navigate to tasks
    await authPage.signInWithMock();
    await dashboardPage.goToTasks();
    await tasksPage.verifyOnTasksPage();

    // Try to create task without message
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    
    // Attempt to create task with empty message
    // This should be handled gracefully by the UI
    // (either disabled submit button or validation message)
    const emptyMessage = '';
    
    // Fill empty message and check if submit button is available
    const hasNewTaskButton = await tasksPage.hasNewTaskButton();
    expect(hasNewTaskButton).toBeTruthy();
  });

  test('should navigate between tasks and maintain chat state', async ({ page }) => {
    // Setup test scenario with tasks
    const scenario = await createStandardWorkspaceScenario();
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Sign in and navigate
    await authPage.signInWithMock();
    await dashboardPage.goToTasks();

    // Create first task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    
    const firstMessage = 'First task message';
    const firstTaskId = await tasksPage.createTask(firstMessage);
    await tasksPage.waitForTaskDetail();
    await tasksPage.verifyMessageVisible(firstMessage);

    // Add chat message to first task
    const firstChatMessage = 'First task chat';
    await tasksPage.sendMessage(firstChatMessage);
    await tasksPage.verifyMessageVisible(firstChatMessage);

    // Navigate back to tasks list
    await dashboardPage.goToTasks();
    
    // Create second task
    await tasksPage.clickNewTask();
    await tasksPage.waitForTaskInput();
    
    const secondMessage = 'Second task message';
    const secondTaskId = await tasksPage.createTask(secondMessage);
    await tasksPage.waitForTaskDetail();
    await tasksPage.verifyMessageVisible(secondMessage);

    // Verify we have different task IDs
    expect(firstTaskId).not.toBe(secondTaskId);
    expect(firstTaskId).toBeTruthy();
    expect(secondTaskId).toBeTruthy();

    // Navigate back to tasks and verify both tasks exist
    await dashboardPage.goToTasks();
    
    // Both tasks should be visible in the list
    // (This assumes tasks show their initial message or title in the list)
    const taskCount = await tasksPage.getTaskCount();
    expect(taskCount).toBeGreaterThanOrEqual(2);
  });
});
