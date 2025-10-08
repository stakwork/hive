import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, WorkspaceSettingsPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Workspace Settings Edit', () => {
  test('should successfully update workspace name, slug, and description', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Create a standard workspace scenario for testing
    const { workspaceSlug } = await createStandardWorkspaceScenario();

    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Debug: Take screenshot and check page content
    await page.screenshot({ path: 'debug-workspace-settings.png' });
    const bodyContent = await page.locator('body').innerHTML();
    console.log('Page content length:', bodyContent.length);
    console.log('Current URL:', page.url());

    // Act - Update workspace settings
    const updatedName = 'Mock Workspace 123';
    const updatedSlug = 'mock-stakgraph-123';
    const updatedDescription = 'Development workspace (mock) 123.';

    await settingsPage.updateWorkspaceSettings({
      name: updatedName,
      slug: updatedSlug,
      description: updatedDescription,
    });

    // Assert - Check if user is redirected to the new URL with updated slug
    await expect(page).toHaveURL(`http://localhost:3000/w/${updatedSlug}/settings`, { timeout: 10000 });

    // Verify that the page loads correctly with the updated settings
    await settingsPage.waitForLoad();

    // Additional verification - check if form fields contain the updated values
    await expect(page.locator(selectors.workspaceSettings.nameInput)).toHaveValue(updatedName);
    await expect(page.locator(selectors.workspaceSettings.slugInput)).toHaveValue(updatedSlug);
    await expect(page.locator(selectors.workspaceSettings.descriptionInput)).toHaveValue(updatedDescription);
  });
});
