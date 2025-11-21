import { expect } from "@playwright/test";
import { test } from "@/__tests__/e2e/support/fixtures/test-hooks";
import { AuthPage, WorkspaceSettingsPage } from "@/__tests__/e2e/support/page-objects";
import { selectors } from "@/__tests__/e2e/support/fixtures/selectors";

test.describe("Workspace Settings Edit", () => {
  test("should successfully update workspace name, slug, and description", async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug from the current URL (mock auth creates a workspace automatically)
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();

    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Act - Update workspace settings
    const timestamp = Date.now();
    const updatedName = `Updated Workspace ${timestamp}`;
    const updatedSlug = `updated-workspace-${timestamp}`;
    const updatedDescription = `Updated description ${timestamp}.`;

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
