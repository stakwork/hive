import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for User Journeys page
 * Encapsulates all user journeys page interactions and assertions
 */
export class UserJourneysPage {
  constructor(private page: Page) {}

  /**
   * Navigate to user journeys page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/user-journeys`);
    await this.waitForLoad();
  }

  /**
   * Wait for user journeys page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.userJourneys)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify page title is visible
   */
  async verifyPageTitle(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.userJourneys)).toContainText('User Journeys');
  }

  /**
   * Click the "Create User Journey" button
   */
  async clickCreateUserJourney(): Promise<void> {
    const createButton = this.page.locator('button:has-text("Create User Journey")');
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();
  }

  /**
   * Verify E2E Tests section is visible
   */
  async verifyE2ETestsSection(): Promise<void> {
    const e2eSection = this.page.locator('text=/E2E Tests/i');
    await expect(e2eSection).toBeVisible({ timeout: 5000 });
  }
}
