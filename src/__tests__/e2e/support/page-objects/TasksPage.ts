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

    // Wait for loading state to disappear (if it exists)
    const loadingText = this.page.getByText('Loading tasks...');
    const isLoading = await loadingText.isVisible().catch(() => false);
    if (isLoading) {
      await loadingText.waitFor({ state: 'hidden', timeout: 10000 });
    }
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
   * Click "New Task" button
   */
  async clickNewTask(): Promise<void> {
    await this.page.locator(selectors.tasks.newTaskButton).click();
    await this.page.waitForURL(/\/w\/.*\/task\/new/, { timeout: 15000 });
    await this.waitForTaskInput();
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
    await expect(this.page.locator(`text=${message}`)).toBeVisible({ timeout: 10000 });
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
