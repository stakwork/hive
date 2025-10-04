import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, WorkspaceSettingsPage } from '@/__tests__/e2e/support/page-objects';

/**
 * Workspace details editing E2E tests.
 * Covers updating workspace name, slug, and description.
 */
test.describe('Workspace Details Editing', () => {
  let authPage: AuthPage;
  let settingsPage: WorkspaceSettingsPage;
  let originalWorkspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    settingsPage = new WorkspaceSettingsPage(page);

    // Sign in and navigate to settings
    await authPage.goto();
    await authPage.signInWithMock();
    originalWorkspaceSlug = authPage.getCurrentWorkspaceSlug();
    await settingsPage.goto(originalWorkspaceSlug);
    await settingsPage.waitForLoad();
  });

  test('should display workspace details form with current values', async ({ page }) => {
    await test.step('verify workspace details card is visible', async () => {
      await settingsPage.expectWorkspaceDetailsVisible();
    });

    await test.step('verify form fields are populated', async () => {
      const name = await settingsPage.getWorkspaceName();
      const slug = await settingsPage.getWorkspaceSlug();
      
      // Verify fields have values
      test.expect(name).toBeTruthy();
      test.expect(slug).toBeTruthy();
      test.expect(slug).toBe(originalWorkspaceSlug);
    });

    await test.step('verify update button is disabled when form is pristine', async () => {
      await settingsPage.expectUpdateButtonDisabled();
    });
  });

  test('should update workspace name successfully', async ({ page }) => {
    const newName = `Updated Workspace ${Date.now()}`;

    await test.step('update workspace name', async () => {
      await settingsPage.updateWorkspaceName(newName);
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit the form', async () => {
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('verify the name was updated', async () => {
      await settingsPage.expectWorkspaceDetails({ name: newName });
    });

    await test.step('verify name persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ name: newName });
    });
  });

  test('should update workspace slug and redirect to new URL', async ({ page }) => {
    const newSlug = `e2e-slug-${Date.now()}`;

    await test.step('update workspace slug', async () => {
      await settingsPage.updateWorkspaceSlug(newSlug);
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit the form', async () => {
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('verify redirect to new URL', async () => {
      await page.waitForURL(`**/w/${newSlug}/settings`, { timeout: 10000 });
      test.expect(page.url()).toContain(`/w/${newSlug}/settings`);
    });

    await test.step('verify the slug was updated in the form', async () => {
      await settingsPage.expectWorkspaceDetails({ slug: newSlug });
    });

    await test.step('verify slug persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ slug: newSlug });
    });
  });

  test('should update workspace description successfully', async ({ page }) => {
    const newDescription = `Updated description created at ${new Date().toISOString()}`;

    await test.step('update workspace description', async () => {
      await settingsPage.updateWorkspaceDescription(newDescription);
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit the form', async () => {
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('verify the description was updated', async () => {
      await settingsPage.expectWorkspaceDetails({ description: newDescription });
    });

    await test.step('verify description persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ description: newDescription });
    });
  });

  test('should update all workspace details at once', async ({ page }) => {
    const timestamp = Date.now();
    const newName = `Complete Update ${timestamp}`;
    const newSlug = `e2e-complete-${timestamp}`;
    const newDescription = `Complete update test at ${new Date().toISOString()}`;

    await test.step('update all workspace fields', async () => {
      await settingsPage.updateWorkspaceName(newName);
      await settingsPage.updateWorkspaceSlug(newSlug);
      await settingsPage.updateWorkspaceDescription(newDescription);
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit the form', async () => {
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('verify redirect to new URL', async () => {
      await page.waitForURL(`**/w/${newSlug}/settings`, { timeout: 10000 });
    });

    await test.step('verify all details were updated', async () => {
      await settingsPage.expectWorkspaceDetails({
        name: newName,
        slug: newSlug,
        description: newDescription,
      });
    });

    await test.step('verify all changes persist after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({
        name: newName,
        slug: newSlug,
        description: newDescription,
      });
    });
  });

  test('should clear workspace description', async ({ page }) => {
    await test.step('set a description first', async () => {
      await settingsPage.updateWorkspaceDescription('Temporary description');
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('clear the description', async () => {
      await settingsPage.updateWorkspaceDescription('');
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit the form', async () => {
      await settingsPage.submitWorkspaceUpdate();
      await settingsPage.expectSuccessToast();
    });

    await test.step('verify description is cleared', async () => {
      await settingsPage.expectWorkspaceDetails({ description: '' });
    });

    await test.step('verify cleared description persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ description: '' });
    });
  });

  test('should handle validation errors for invalid slug format', async ({ page }) => {
    await test.step('try to set invalid slug with spaces', async () => {
      await settingsPage.updateWorkspaceSlug('invalid slug with spaces');
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit and expect validation error', async () => {
      await settingsPage.submitWorkspaceUpdate();
      
      // Look for validation error message
      const errorMessage = page.locator('text=/invalid|format/i');
      await test.expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step('verify workspace was not updated', async () => {
      await settingsPage.expectWorkspaceDetails({ slug: originalWorkspaceSlug });
    });
  });

  test('should handle validation errors for empty name', async ({ page }) => {
    await test.step('try to set empty name', async () => {
      await settingsPage.updateWorkspaceName('');
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('submit and expect validation error', async () => {
      await settingsPage.submitWorkspaceUpdate();
      
      // Look for validation error message
      const errorMessage = page.locator('text=/required|empty/i');
      await test.expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('should enable update button only when form is dirty', async ({ page }) => {
    await test.step('verify button is disabled initially', async () => {
      await settingsPage.expectUpdateButtonDisabled();
    });

    await test.step('make a change to enable the button', async () => {
      await settingsPage.updateWorkspaceName('New Name');
      await settingsPage.expectUpdateButtonEnabled();
    });

    await test.step('revert the change to disable the button again', async () => {
      const originalName = await settingsPage.getWorkspaceName();
      
      // Get back to the form and reload to reset
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectUpdateButtonDisabled();
    });
  });
});
