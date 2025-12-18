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
    await this.goto();
    const signInButton = this.page.locator(selectors.auth.mockSignInButton);
    await expect(signInButton).toBeVisible({ timeout: 10000 });
    await signInButton.click();

    // Wait for redirect to workspace (increased timeout for CI environment)
    // This involves: signIn callback → session callback → workspace query → client redirect
    await this.page.waitForURL(/\/w\/.*/, { timeout: 30000 });
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

  /**
   * Open user menu dropdown
   * Uses keyboard interaction to reliably open dropdown in CI environment
   */
  async openUserMenu(): Promise<void> {
    const userMenuTrigger = this.page.locator(selectors.userMenu.trigger);
    await expect(userMenuTrigger).toBeVisible({ timeout: 10000 });
    
    // Focus the trigger button
    await userMenuTrigger.focus();
    
    // Press Enter to open the dropdown (bypasses overlay issues)
    await this.page.keyboard.press('Enter');
    
    // Wait for dropdown menu to open by checking for the logout button
    const logoutButton = this.page.locator(selectors.userMenu.logoutButton);
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Logout user via user menu
   */
  async logout(): Promise<void> {
    await this.openUserMenu();
    
    const logoutButton = this.page.locator(selectors.userMenu.logoutButton);
    await logoutButton.click();
  }

  /**
   * Verify user is logged out (redirected to login page)
   */
  async verifyLoggedOut(): Promise<void> {
    // Wait for redirect to auth/signin or home page
    await this.page.waitForURL(/\/(auth\/signin)?$/, { timeout: 10000 });
    
    // Verify mock sign-in button is visible
    const signInButton = this.page.locator(selectors.auth.mockSignInButton);
    await expect(signInButton).toBeVisible({ timeout: 10000 });
  }
}
