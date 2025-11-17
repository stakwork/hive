import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

/**
 * Mock Sign In E2E Tests
 * 
 * Tests the mock authentication flow which is used for development and testing.
 * Verifies that users can sign in with the mock provider and access workspace features.
 */
test.describe('Mock Sign In', () => {
  test('should successfully sign in with mock provider and verify workspace switcher', async ({ page }) => {
    // Arrange
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Act - Sign in with mock provider
    await authPage.signInWithMock();

    // Assert - Verify user is authenticated and redirected to workspace
    await dashboardPage.waitForLoad();
    
    // Verify workspace switcher is present and accessible
    const workspaceSwitcherTrigger = page.locator('button').filter({ hasText: /mock|workspace/i }).first();
    await expect(workspaceSwitcherTrigger).toBeVisible({ timeout: 10000 });
    
    // Click the workspace switcher to open the dropdown
    await workspaceSwitcherTrigger.click();
    
    // Verify the workspace switcher label with "Workspaces" text is visible
    const switcherLabel = page.locator(selectors.workspace.switcherLabel);
    await expect(switcherLabel).toBeVisible({ timeout: 5000 });
    await expect(switcherLabel).toContainText('Workspaces');
  });

  test('should persist authentication after page reload', async ({ page }) => {
    // Arrange
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Act - Sign in and get workspace slug
    await authPage.signInWithMock();
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();

    // Reload the page
    await page.reload();

    // Assert - Verify session persists
    await dashboardPage.waitForLoad();
    expect(page.url()).toContain(`/w/${workspaceSlug}`);
    
    // Verify workspace switcher is still accessible
    const workspaceSwitcherTrigger = page.locator('button').filter({ hasText: /mock|workspace/i }).first();
    await expect(workspaceSwitcherTrigger).toBeVisible({ timeout: 10000 });
  });

  test('should allow navigation to different workspace sections after sign in', async ({ page }) => {
    // Arrange
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Act - Sign in
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();

    // Assert - Verify navigation elements are visible
    const settingsButton = page.locator(selectors.navigation.settingsButton);
    await expect(settingsButton).toBeVisible({ timeout: 10000 });

    // Verify other navigation links are accessible
    const tasksLink = page.locator(selectors.navigation.tasksLink).first();
    const insightsLink = page.locator(selectors.navigation.insightsLink).first();
    
    // Navigation items might be in collapsed state, so just verify they exist
    await expect(tasksLink).toBeAttached();
    await expect(insightsLink).toBeAttached();
  });
});
