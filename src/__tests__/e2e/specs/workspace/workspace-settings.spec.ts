import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage, WorkspaceSettingsPage } from '@/__tests__/e2e/support/page-objects';

/**
 * Workspace settings management journey tests.
 * Covers editing workspace details like name, slug, and description.
 */
test.describe('Workspace Settings', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let settingsPage: WorkspaceSettingsPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    settingsPage = new WorkspaceSettingsPage(page);

    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await settingsPage.goto(workspaceSlug);
    await settingsPage.waitForLoad();
  });

  test('owner can edit workspace name', async ({ page }) => {
    const newName = `Updated Workspace ${Date.now()}`;

    await test.step('update workspace name', async () => {
      await settingsPage.updateWorkspaceDetails({ name: newName });
    });

    await test.step('verify name persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ name: newName });
    });
  });

  test('owner can edit workspace description', async ({ page }) => {
    const newDescription = `E2E test description ${Date.now()}`;

    await test.step('update workspace description', async () => {
      await settingsPage.updateWorkspaceDetails({ description: newDescription });
    });

    await test.step('verify description persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ description: newDescription });
    });
  });

  test('owner can edit workspace slug and gets redirected', async ({ page }) => {
    const newSlug = `e2e-slug-${Date.now()}`;

    await test.step('update workspace slug', async () => {
      await settingsPage.updateWorkspaceDetails({ slug: newSlug });
    });

    await test.step('verify redirect to new URL', async () => {
      await settingsPage.waitForLoad();
      await page.waitForURL(`**/w/${newSlug}/settings`, { timeout: 10000 });
    });

    await test.step('verify slug persists after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails({ slug: newSlug });
    });
  });

  test('owner can edit all workspace details at once', async ({ page }) => {
    const timestamp = Date.now();
    const updates = {
      name: `Complete Update ${timestamp}`,
      slug: `e2e-complete-${timestamp}`,
      description: `Fully updated workspace ${timestamp}`,
    };

    await test.step('update all workspace details', async () => {
      await settingsPage.updateWorkspaceDetails(updates);
    });

    await test.step('verify redirect to new URL', async () => {
      await settingsPage.waitForLoad();
      await page.waitForURL(`**/w/${updates.slug}/settings`, { timeout: 10000 });
    });

    await test.step('verify all changes persist after page reload', async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectWorkspaceDetails(updates);
    });
  });
});
