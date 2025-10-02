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
    await this.page.goto(`/w/${workspaceSlug}/tasks`);
    await this.waitForLoad();
  }

  /**
   * Wait for tasks page to load
   */
  async waitForLoad(): Promise<void> {
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
    await this.page.waitForURL(/\/w\/.*\/task\/new/, { timeout: 10000 });
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
    const input = this.page.locator(selectors.tasks.taskInput).first();
    await input.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Create a new task with message
   */
  async createTask(message: string): Promise<string> {
    // Fill task input
    const input = this.page.locator(selectors.tasks.taskInput).first();
    await input.fill(message);

    // Submit task
    const submitButton = this.page.locator(selectors.tasks.submitButton).first();
    await submitButton.click();

    // Wait for task creation and URL change
    await this.page.waitForURL(/\/w\/.*\/task\/[^\/]+$/, { timeout: 15000 });

    // Extract task ID from URL
    const url = this.page.url();
    const match = url.match(/\/task\/([^\/]+)$/);
    return match ? match[1] : '';
  }

  /**
   * Send a message in task chat
   */
  async sendMessage(message: string): Promise<void> {
    const input = this.page.locator(selectors.tasks.taskInput).last();
    await input.fill(message);
    await this.page.keyboard.press('Enter');
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
    const titleElement = this.page.locator(`text="${title}"`).first();
    await expect(titleElement).toBeVisible({ timeout: 10000 });
  }

  /**
   * Find task in list by title
   */
  async findTaskInList(title: string): Promise<boolean> {
    const taskCard = this.page.locator(`text="${title}"`).first();
    return await taskCard.isVisible({ timeout: 5000 }).catch(() => false);
  }
}
