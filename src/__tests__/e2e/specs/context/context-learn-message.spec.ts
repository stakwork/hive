import { test, expect } from '@playwright/test';
import { AuthPage } from '../../support/page-objects/AuthPage';
import { DashboardPage } from '../../support/page-objects/DashboardPage';
import { ContextLearnPage } from '../../support/page-objects/ContextLearnPage';
import { selectors } from '../../support/fixtures/selectors';

/**
 * E2E tests for Context Learn page (Documentation Viewer)
 * Tests the new documentation viewer UI that replaced the chat interface
 */
test.describe('Context Learn Documentation Viewer', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let contextLearnPage: ContextLearnPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    contextLearnPage = new ContextLearnPage(page);

    // Authenticate and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
    
    // Extract workspace slug from URL
    const url = page.url();
    const match = url.match(/\/w\/([^/]+)/);
    workspaceSlug = match ? match[1] : 'default';
  });

  test('should navigate to Context Learn page via sidebar', async ({ page }) => {
    // Navigate to Context Learn page via sidebar
    await contextLearnPage.navigateViaNavigation();

    // Verify we're on the Context Learn page
    await expect(page).toHaveURL(/\/w\/.*\/learn/, { timeout: 30000 });

    // Verify the page loaded (either docs or concepts section visible)
    const isLoaded = await contextLearnPage.isLoaded();
    expect(isLoaded).toBe(true);
  });

  test('should display docs and concepts sections', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Verify docs section is visible
    const isDocsSectionVisible = await contextLearnPage.isDocsSectionVisible();
    expect(isDocsSectionVisible).toBe(true);

    // Verify concepts section is visible
    const isConceptsSectionVisible = await contextLearnPage.isConceptsSectionVisible();
    expect(isConceptsSectionVisible).toBe(true);
  });

  test('should display content area when a doc is clicked', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Wait for docs to load
    await expect(page.locator(selectors.learn.docsSection)).toBeVisible();

    // Check if there are any doc items
    const docItemCount = await page.locator(selectors.learn.docItem).count();
    
    if (docItemCount > 0) {
      // Click first doc item
      await contextLearnPage.clickDocItem(0);

      // Verify content area is visible
      const isContentAreaVisible = await contextLearnPage.isContentAreaVisible();
      expect(isContentAreaVisible).toBe(true);

      // Verify edit button is visible in view mode
      const isEditButtonVisible = await contextLearnPage.isEditButtonVisible();
      expect(isEditButtonVisible).toBe(true);
    } else {
      // Skip test if no docs available
      test.skip();
    }
  });

  test('should complete full user journey: dashboard -> Context Learn -> view doc', async ({ page }) => {
    // Starting from dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    // Navigate to Context Learn via sidebar
    await contextLearnPage.navigateViaNavigation();

    // Verify we're on Context Learn page
    await expect(page).toHaveURL(/\/w\/.*\/learn/);

    // Verify docs section is present
    await expect(page.locator(selectors.learn.docsSection)).toBeVisible();

    // Verify concepts section is present
    await expect(page.locator(selectors.learn.conceptsSection)).toBeVisible();
  });

  test('should allow editing documentation (if docs available)', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Wait for docs section
    await expect(page.locator(selectors.learn.docsSection)).toBeVisible();

    // Check if there are any doc items
    const docItemCount = await page.locator(selectors.learn.docItem).count();
    
    if (docItemCount > 0) {
      // Click first doc item
      await contextLearnPage.clickDocItem(0);

      // Wait for content area
      await expect(page.locator(selectors.learn.contentArea)).toBeVisible();

      // Click edit button
      await contextLearnPage.clickEditButton();

      // Verify view button appears (indicating we're in edit mode)
      await expect(page.locator(selectors.learn.viewButton)).toBeVisible();

      // Verify save button appears
      await expect(page.locator(selectors.learn.saveButton)).toBeVisible();

      // Click view button to return to view mode
      await contextLearnPage.clickViewButton();

      // Verify edit button is back
      await expect(page.locator(selectors.learn.editButton)).toBeVisible();
    } else {
      // Skip test if no docs available
      test.skip();
    }
  });
});
