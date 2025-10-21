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
    // Wait for the "Add Ticket" button or tickets section to be visible
    await waitForElement(this.page, 'text=Tickets', { timeout: 10000 });
  }

  /**
   * Click "Add Ticket" button to open ticket creation form
   */
  async clickAddTicket(): Promise<void> {
    const addButton = this.page.locator('button:has-text("Add Ticket")');
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click();
    // Wait for the ticket form to appear
    await this.page.waitForTimeout(500);
  }

  /**
   * Create a new ticket
   */
  async createTicket(title: string, description?: string): Promise<void> {
    // Make sure the form is open
    const titleInput = this.page.locator('input[placeholder*="Ticket title"]').first();
    const isVisible = await titleInput.isVisible().catch(() => false);
    
    if (!isVisible) {
      await this.clickAddTicket();
    }
    
    // Fill in ticket title
    await titleInput.waitFor({ state: 'visible', timeout: 10000 });
    await titleInput.fill(title);
    
    // Optionally fill in description
    if (description) {
      const descInput = this.page.locator('textarea[placeholder*="Describe this ticket"]').first();
      await descInput.fill(description);
    }
    
    // Click create button
    const createButton = this.page.locator('button:has-text("Create")').last();
    await createButton.click();
    
    // Wait for ticket to be created
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
    await this.page.waitForURL(/\/w\/.*\/roadmap\/.*/, { timeout: 10000 });
  }
}
