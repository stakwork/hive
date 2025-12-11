import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Context Learn page
 * Encapsulates all Context Learn page interactions and assertions
 */
export class ContextLearnPage {
  constructor(private page: Page) {}

  /**
   * Navigate to Context Learn page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/learn`);
    await this.waitForLoad();
  }

  /**
   * Wait for Context Learn page to fully load
   */
  async waitForLoad(): Promise<void> {
    // Wait for the message input to be visible as indicator of page load
    await expect(this.page.locator(selectors.learn.messageInput)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Context Learn page via sidebar navigation
   */
  async navigateViaNavigation(): Promise<void> {
    // First expand the Context section if not already expanded
    const contextButton = this.page.locator(selectors.navigation.contextButton);
    const learnLink = this.page.locator(selectors.navigation.learnLink).first();

    // Check if learn link is visible, if not, click Context to expand
    const isLearnVisible = await learnLink.isVisible().catch(() => false);
    if (!isLearnVisible) {
      await contextButton.click();
      await learnLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    await learnLink.click();
    await this.page.waitForURL(/\/w\/.*\/learn/, { timeout: 10000 });
    await this.waitForLoad();
  }

  /**
   * Send a message in the Context Learn chat
   */
  async sendMessage(message: string): Promise<void> {
    const messageInput = this.page.locator(selectors.learn.messageInput);
    const sendButton = this.page.locator(selectors.learn.messageSend);

    // Fill the message input
    await messageInput.fill(message);

    // Wait for send button to be enabled (not disabled)
    await expect(sendButton).toBeEnabled({ timeout: 5000 });

    // Click the send button
    await sendButton.click();
  }

  /**
   * Check if the message input is visible
   */
  async isMessageInputVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.messageInput).isVisible();
  }

  /**
   * Check if the send button is visible
   */
  async isSendButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.messageSend).isVisible();
  }

  /**
   * Get the value of the message input
   */
  async getMessageInputValue(): Promise<string> {
    return await this.page.locator(selectors.learn.messageInput).inputValue();
  }

  /**
   * Check if page is loaded (message input is visible)
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.learn.messageInput).isVisible();
  }
}
