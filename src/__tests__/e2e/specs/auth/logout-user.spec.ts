import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage } from '../../support/page-objects/AuthPage';
import { DashboardPage } from '../../support/page-objects/DashboardPage';
import { selectors } from '../../support/fixtures/selectors';

/**
 * E2E Tests: Logout User
 * 
 * Tests user logout functionality including:
 * - Basic logout and redirect
 * - Logout after navigating multiple pages
 */

test.describe('Logout User', () => {
  test('should successfully logout user and redirect to login page', async ({ page }) => {
    // Setup
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Authenticate
    await authPage.signInWithMock();
    await authPage.verifyAuthenticated();

    // Verify user is on workspace page
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    expect(workspaceSlug).toBeTruthy();

    // Navigate to dashboard
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.waitForLoad();

    // Logout
    await authPage.logout();

    // Verify user is logged out by checking the signin page or home page with signin button
    // NextAuth redirects to /auth/signin which then redirects to / with the signin button
    await page.waitForURL(/\/(auth\/signin)?$/, { timeout: 10000 });
    const mockSignInButton = page.locator(selectors.auth.mockSignInButton);
    await expect(mockSignInButton).toBeVisible({ timeout: 10000 });
  });

  test('should logout user after navigating through multiple pages', async ({ page }) => {
    // Setup
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Authenticate
    await authPage.signInWithMock();
    await authPage.verifyAuthenticated();

    const workspaceSlug = authPage.getCurrentWorkspaceSlug();

    // Navigate through multiple pages using direct navigation
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.waitForLoad();

    // Navigate to tasks page directly
    await page.goto(`http://localhost:3000/w/${workspaceSlug}/tasks`);
    await page.waitForURL(`**/w/${workspaceSlug}/tasks**`, { timeout: 5000 });

    // Navigate back to dashboard
    await dashboardPage.goto(workspaceSlug);
    await dashboardPage.waitForLoad();

    // Logout
    await authPage.logout();

    // Verify user is logged out by checking the signin page or home page with signin button
    // NextAuth redirects to /auth/signin which then redirects to / with the signin button
    await page.waitForURL(/\/(auth\/signin)?$/, { timeout: 10000 });
    const mockSignInButton = page.locator(selectors.auth.mockSignInButton);
    await expect(mockSignInButton).toBeVisible({ timeout: 10000 });
  });
});
