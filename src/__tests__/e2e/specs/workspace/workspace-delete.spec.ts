import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, WorkspaceSettingsPage } from '@/__tests__/e2e/support/page-objects';

test.describe('Workspace Deletion', () => {
  test('should successfully delete a workspace with confirmation', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug and name from the current URL
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Get the workspace name from the form (it's prefilled)
    const workspaceName = await page.inputValue('[data-testid="workspace-settings-name-input"]');

    // Act - Delete the workspace
    await settingsPage.deleteWorkspace(workspaceName);

    // Assert - Check that we're redirected to the workspaces list
    await expect(page).toHaveURL('http://localhost:3000/workspaces', { timeout: 15000 });

    // Verify the deleted workspace is not in the list
    // The workspace should not be visible on the workspaces page
    const workspaceLink = page.locator(`a[href="/w/${workspaceSlug}"]`);
    await expect(workspaceLink).toHaveCount(0, { timeout: 5000 });
  });

  test('should not delete workspace if confirmation name is incorrect', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug from the current URL
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Act - Try to delete with wrong confirmation name
    await settingsPage.initiateDelete();
    
    // Fill in incorrect confirmation text
    const dialog = page.locator('[data-testid="delete-workspace-dialog"]');
    await dialog.locator('[data-testid="delete-workspace-confirmation-input"]').fill('Wrong Name');
    
    // The confirm button should be disabled
    const confirmButton = dialog.locator('[data-testid="delete-workspace-confirm-button"]');
    await expect(confirmButton).toBeDisabled();

    // Cancel the dialog
    await dialog.locator('[data-testid="delete-workspace-cancel-button"]').click();

    // Assert - Should still be on the settings page
    await expect(page).toHaveURL(`http://localhost:3000/w/${workspaceSlug}/settings`);
  });

  test('should cancel workspace deletion', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug from the current URL
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    
    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Act - Initiate delete and then cancel
    await settingsPage.initiateDelete();
    
    const dialog = page.locator('[data-testid="delete-workspace-dialog"]');
    await expect(dialog).toBeVisible();
    
    await dialog.locator('[data-testid="delete-workspace-cancel-button"]').click();

    // Assert - Dialog should be hidden and we should still be on settings page
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(`http://localhost:3000/w/${workspaceSlug}/settings`);
  });
});
