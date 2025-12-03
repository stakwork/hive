import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Learn page
 * Encapsulates all Learning Assistant interactions and assertions
 */
export class LearnPage {
  constructor(private page: Page) {}

  /**
   * Navigate to learn page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/learn`);
    await this.waitForLoad();
  }

  /**
   * Wait for learn page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.learn.learningAssistantHeading)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify we're on the learn page by checking the Learning Assistant heading
   */
  async verifyLearningAssistant(): Promise<void> {
    await expect(this.page.locator(selectors.learn.learningAssistantHeading)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to learn page via sidebar
   */
  async navigateViaNavigation(): Promise<void> {
    // First, expand Context section if it's not already expanded
    const contextButton = this.page.locator('[data-testid="nav-context"]');
    const learnLink = this.page.locator(selectors.navigation.learnLink);

    // Check if learn link is visible, if not, click context to expand
    const isLearnVisible = await learnLink.isVisible().catch(() => false);
    if (!isLearnVisible) {
      await contextButton.click();
      // Wait for learn link to become visible after expanding
      await learnLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await learnLink.click();
    await this.page.waitForURL(/\/w\/.*\/learn/, { timeout: 10000 });
  }

  /**
   * Check if chat input is visible
   */
  async isChatInputVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.chatInput).isVisible({ timeout: 3000 }).catch(() => false);
  }
}
