import { Page } from '@playwright/test';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Phase Detail page
 * Encapsulates all phase detail interactions
 */
export class PhaseDetailPage {
  constructor(private page: Page) {}

  /**
   * Navigate to phase detail page
   */
  async goto(workspaceSlug: string, phaseId: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/phases/${phaseId}`);
    await this.waitForLoad();
  }

  /**
   * Wait for phase detail page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForURL(/\/w\/.*\/phases\/.*/, { timeout: 10000 });
    // Wait for the "Add Task" button or tasks section to be visible
    await waitForElement(this.page, 'text=Tasks', { timeout: 10000 });
  }

  /**
   * Click "Add Task" button to open task creation form
   */
  async clickAddTicket(): Promise<void> {
    const addButton = this.page.locator('button:has-text("Add Task")');
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click();
    // Wait for the task form to appear
    await this.page.waitForTimeout(500);
  }

  /**
   * Create a new ticket
   */
  async createTicket(title: string, description?: string): Promise<void> {
    // Make sure the form is open
    const titleInput = this.page.locator('input[placeholder*="Task title"]').first();
    const isVisible = await titleInput.isVisible().catch(() => false);

    if (!isVisible) {
      await this.clickAddTicket();
    }

    // Fill in task title
    await titleInput.waitFor({ state: 'visible', timeout: 10000 });
    await titleInput.fill(title);

    // Optionally fill in description
    if (description) {
      const descInput = this.page.locator('textarea[placeholder*="Describe this task"]').first();
      await descInput.fill(description);
    }

    // Click create button
    const createButton = this.page.locator('button:has-text("Create")').last();
    await createButton.click();

    // Wait for task to be created
    await this.page.waitForTimeout(1000);
  }

  /**
   * Add multiple tickets in sequence
   */
  async addTickets(titles: string[]): Promise<void> {
    for (const title of titles) {
      await this.createTicket(title);
    }
  }

  /**
   * Verify ticket exists in the list
   */
  async verifyTicketExists(title: string): Promise<void> {
    await waitForElement(this.page, `text=${title}`, { timeout: 10000 });
  }

  /**
   * Navigate back to feature detail
   */
  async clickBack(): Promise<void> {
    const backButton = this.page.locator('button:has-text("Back")').first();
    await backButton.click();
    await this.page.waitForURL(/\/w\/.*\/plan\/.*/, { timeout: 10000 });
  }
}
