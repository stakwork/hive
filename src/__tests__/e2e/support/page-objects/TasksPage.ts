import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Tasks page
 */
export class TasksPage {
  constructor(private page: Page) {}

  /**
   * Navigate to tasks page
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/tasks`);
    await this.waitForLoad();
  }

  /**
   * Wait for tasks page to load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.tasks)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify we're on the tasks page
   */
  async verifyOnTasksPage(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.tasks)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if "New Task" button is visible
   */
  async hasNewTaskButton(): Promise<boolean> {
    const button = this.page.locator(selectors.tasks.newTaskButton);
    return await button.count() > 0;
  }

  /**
   * Click "New Task" button or "Connect Repository" button depending on setup
   */
  async clickNewTask(): Promise<void> {
    // Check if we have the "New Task" button or need to connect repository first
    const newTaskButton = this.page.locator(selectors.tasks.newTaskButton);
    const connectRepoButton = this.page.locator(selectors.tasks.connectRepoButton);
    
    const hasNewTask = await newTaskButton.count() > 0;
    const hasConnectRepo = await connectRepoButton.count() > 0;
    
    if (hasNewTask) {
      await newTaskButton.click();
      await this.page.waitForURL(/\/w\/.*\/task\/new/, { timeout: 10000 });
    } else if (hasConnectRepo) {
      // If repository needs to be connected first, click Connect Repository
      await connectRepoButton.click();
      // Wait for navigation to code-graph page
      await this.page.waitForURL(/\/w\/.*\/code-graph/, { timeout: 10000 });
      // For testing purposes, we'll throw an error here since we need a connected repo
      throw new Error('Repository needs to be connected before creating tasks. Connect a repository first.');
    } else {
      throw new Error('Neither New Task button nor Connect Repository button found on tasks page');
    }
  }

  /**
   * Check if connect repository button is visible
   */
  async hasConnectRepositoryButton(): Promise<boolean> {
    const button = this.page.locator(selectors.tasks.connectRepoButton);
    return await button.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Navigate to new task page directly
   */
  async goToNewTask(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/task/new`);
    await this.waitForTaskInput();
  }

  /**
   * Wait for task input to be visible
   */
  async waitForTaskInput(): Promise<void> {
    const input = this.page.locator(selectors.tasks.taskStartInput);
    await input.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Create a new task with message
   */
  async createTask(message: string): Promise<string> {
    // Fill task input
    const input = this.page.locator(selectors.tasks.taskStartInput);
    await input.fill(message);

    // Submit task
    const submitButton = this.page.locator(selectors.tasks.taskStartSubmit);
    await submitButton.click();

    // Wait for URL to change from /task/new to /task/[id]
    await this.page.waitForURL((url) => {
      return url.pathname.includes('/task/') && !url.pathname.includes('/task/new');
    }, { timeout: 15000 });

    // Extract task ID from URL
    const url = this.page.url();
    const match = url.match(/\/task\/([^\/\?#]+)/);
    return match ? match[1] : '';
  }

  /**
   * Wait for task detail page to load (after task creation)
   */
  async waitForTaskDetail(): Promise<void> {
    // Wait for chat input to be visible (indicates task detail page loaded)
    const chatInput = this.page.locator(selectors.tasks.chatMessageInput);
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Send a message in task chat
   */
  async sendMessage(message: string): Promise<void> {
    const input = this.page.locator(selectors.tasks.chatMessageInput);
    await input.fill(message);
    const submitButton = this.page.locator(selectors.tasks.chatMessageSubmit);
    await submitButton.click();
  }

  /**
   * Verify message appears in chat
   */
  async verifyMessageVisible(message: string): Promise<void> {
    // Use a more specific selector that targets chat messages specifically
    // Look for the message within chat container or use more specific locators
    const chatMessage = this.page.locator('.chat-message, [data-testid="chat-message"], .message').filter({ hasText: message });
    const fallbackMessage = this.page.getByRole('paragraph').filter({ hasText: message });
    
    // Try chat message first, then fallback to any paragraph with the text
    try {
      await expect(chatMessage.first()).toBeVisible({ timeout: 5000 });
    } catch {
      await expect(fallbackMessage.first()).toBeVisible({ timeout: 5000 });
    }
  }

  /**
   * Verify task title is visible
   */
  async verifyTaskTitle(title: string): Promise<void> {
    const titleElement = this.page.locator(selectors.tasks.taskTitle);
    await expect(titleElement).toBeVisible({ timeout: 10000 });
    await expect(titleElement).toContainText(title);
  }

  /**
   * Find task in list by title
   */
  async findTaskInList(title: string): Promise<boolean> {
    const taskCard = this.page.locator(`text="${title}"`).first();
    return await taskCard.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Verify task exists in list by title
   */
  async verifyTaskInList(title: string): Promise<void> {
    const taskCard = this.page.locator(selectors.tasks.taskCard).filter({ hasText: title });
    await expect(taskCard).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get task count from the list
   */
  async getTaskCount(): Promise<number> {
    return await this.page.locator(selectors.tasks.taskCard).count();
  }

  /**
   * Click on a task by title to open it
   */
  async clickTask(title: string): Promise<void> {
    const taskCard = this.page.locator(selectors.tasks.taskCard).filter({ hasText: title });
    await taskCard.click();
    await this.page.waitForURL(/\/w\/.*\/task\/[^\/]+$/, { timeout: 10000 });
  }
}
