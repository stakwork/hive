import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Authentication
 */
export class AuthPage {
  constructor(private page: Page) {}

  /**
   * Navigate to home page
   */
  async goto(): Promise<void> {
    await this.page.goto('http://localhost:3000');
  }

  /**
   * Verify welcome message is visible
   */
  async verifyWelcomeMessage(): Promise<void> {
    await expect(this.page.locator(selectors.auth.welcomeMessage)).toContainText('Welcome to Hive');
  }

  /**
   * Sign in using mock provider
   */
  async signInWithMock(): Promise<void> {
    const signInButton = this.page.locator(selectors.auth.mockSignInButton);
    await expect(signInButton).toBeVisible({ timeout: 10000 });
    await signInButton.click();

    // Wait for redirect to workspace
    await this.page.waitForURL(/\/w\/.*/, { timeout: 10000 });
  }

  /**
   * Verify user is authenticated
   */
  async verifyAuthenticated(): Promise<void> {
    const settingsButton = this.page.locator(selectors.navigation.settingsButton);
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get current workspace slug from URL
   */
  getCurrentWorkspaceSlug(): string {
    const url = this.page.url();
    const match = url.match(/\/w\/([^\/]+)/);
    if (!match) {
      throw new Error('Could not extract workspace slug from URL');
    }
    return match[1];
  }

  /**
   * Verify workspace switcher is visible
   */
  async verifyWorkspaceSwitcher(): Promise<void> {
    const switcher = this.page.locator('button').filter({ hasText: /mock/i }).first();
    await expect(switcher).toBeVisible();
  }

  /**
   * Reload page and verify session persists
   */
  async reloadAndVerifySession(expectedSlug: string): Promise<void> {
    await this.page.reload();
    await this.verifyAuthenticated();
    expect(this.getCurrentWorkspaceSlug()).toBe(expectedSlug);
  }
}
