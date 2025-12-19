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
   * Open user menu
   */
  async openUserMenu() {
    const userMenuTrigger = this.page.locator(selectors.userMenu.trigger);
    await expect(userMenuTrigger).toBeVisible({ timeout: 10000 });
    
    // Remove Next.js dev overlay that blocks interactions in tests
    await this.page.evaluate(() => {
      const overlay = document.querySelector('nextjs-portal');
      if (overlay) {
        overlay.remove();
      }
    });
    
    // Wait a brief moment for DOM updates after overlay removal
    await this.page.waitForTimeout(100);
    
    // Click the trigger button with force to bypass the overlay intercepting pointer events
    await userMenuTrigger.click({ force: true, timeout: 10000 });
    
    // Wait for the menu to be visible by checking for data-state="open"
    await expect(userMenuTrigger).toHaveAttribute('data-state', 'open', { timeout: 5000 });
    
    // Wait for the logout button to be visible as confirmation menu is open
    const logoutButton = this.page.locator(selectors.userMenu.logoutButton);
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Logout user
   */
  async logout() {
    await this.openUserMenu();
    
    // Click the logout button using data-testid
    const logoutButton = this.page.locator(selectors.userMenu.logoutButton);
    await logoutButton.click();
    
    // Wait for redirect to signin page after logout (NextAuth redirects to /auth/signin)
    await this.page.waitForURL('http://localhost:3000/auth/signin', { timeout: 10000 });
  }
}
