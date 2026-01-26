import { test, expect } from '@playwright/test';
import { AuthPage, DashboardPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

/**
 * Visual regression tests for bottom component alignment
 * Verifies WorkspaceMembersPreview, ChatInput, and ActionsToolbar align at same baseline
 */
test.describe('Bottom Components Alignment', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);

    // Sign in and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test('should align all bottom components at same baseline', async ({ page }) => {
    // Wait for graph to load
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    // Get bounding boxes for all bottom components
    const workspaceMembersPreview = page.locator('[data-testid="workspace-members-preview"]').first();
    const actionsToolbar = page.locator('#actions-toolbar');
    
    // Verify components are visible
    await expect(workspaceMembersPreview).toBeVisible({ timeout: 10000 });
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    // Get bounding boxes
    const workspaceMembersBox = await workspaceMembersPreview.boundingBox();
    const actionsToolbarBox = await actionsToolbar.boundingBox();

    expect(workspaceMembersBox).toBeTruthy();
    expect(actionsToolbarBox).toBeTruthy();

    if (workspaceMembersBox && actionsToolbarBox) {
      // Calculate bottom positions (y + height)
      const workspaceMembersBottom = workspaceMembersBox.y + workspaceMembersBox.height;
      const actionsToolbarBottom = actionsToolbarBox.y + actionsToolbarBox.height;

      // Both should be at similar bottom positions (within 5px tolerance)
      const bottomDifference = Math.abs(workspaceMembersBottom - actionsToolbarBottom);
      expect(bottomDifference).toBeLessThan(5);
    }
  });

  test('should verify WorkspaceMembersPreview has h-10 equivalent height', async ({ page }) => {
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    const workspaceMembersPreview = page.locator('[data-testid="workspace-members-preview"]').first();
    await expect(workspaceMembersPreview).toBeVisible({ timeout: 10000 });

    const box = await workspaceMembersPreview.boundingBox();
    expect(box).toBeTruthy();

    if (box) {
      // h-10 is 40px, allowing for some tolerance due to borders
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeLessThanOrEqual(46); // accounting for borders
    }
  });

  test('should verify ActionsToolbar buttons have consistent 40px height', async ({ page }) => {
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    const actionsToolbar = page.locator('#actions-toolbar');
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    // Check camera recenter button
    const cameraButton = actionsToolbar.locator('button').first();
    const cameraBox = await cameraButton.boundingBox();
    
    expect(cameraBox).toBeTruthy();
    if (cameraBox) {
      // w-10 h-10 is 40px
      expect(cameraBox.width).toBeGreaterThanOrEqual(38);
      expect(cameraBox.width).toBeLessThanOrEqual(42);
      expect(cameraBox.height).toBeGreaterThanOrEqual(38);
      expect(cameraBox.height).toBeLessThanOrEqual(42);
    }
  });

  test('should verify ActionsToolbar uses bottom-4 positioning', async ({ page }) => {
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    const actionsToolbar = page.locator('#actions-toolbar');
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    // Verify the toolbar has correct positioning class
    const hasBottomClass = await actionsToolbar.evaluate((el) => {
      return el.classList.contains('bottom-4');
    });

    expect(hasBottomClass).toBe(true);

    // Verify it doesn't have old bottom-5 class
    const hasOldBottomClass = await actionsToolbar.evaluate((el) => {
      return el.classList.contains('bottom-5');
    });

    expect(hasOldBottomClass).toBe(false);
  });

  test('should verify all bottom components maintain consistent spacing', async ({ page }) => {
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    const workspaceMembersPreview = page.locator('[data-testid="workspace-members-preview"]').first();
    const actionsToolbar = page.locator('#actions-toolbar');

    await expect(workspaceMembersPreview).toBeVisible({ timeout: 10000 });
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    const viewportSize = page.viewportSize();
    expect(viewportSize).toBeTruthy();

    if (viewportSize) {
      const workspaceMembersBox = await workspaceMembersPreview.boundingBox();
      const actionsToolbarBox = await actionsToolbar.boundingBox();

      expect(workspaceMembersBox).toBeTruthy();
      expect(actionsToolbarBox).toBeTruthy();

      if (workspaceMembersBox && actionsToolbarBox) {
        // Both components should be at bottom of viewport
        // bottom-4 is 1rem = 16px from bottom
        const expectedDistanceFromBottom = 16;
        
        const workspaceDistanceFromBottom = viewportSize.height - (workspaceMembersBox.y + workspaceMembersBox.height);
        const toolbarDistanceFromBottom = viewportSize.height - (actionsToolbarBox.y + actionsToolbarBox.height);

        // Allow some tolerance for rendering differences
        expect(workspaceDistanceFromBottom).toBeGreaterThanOrEqual(expectedDistanceFromBottom - 5);
        expect(workspaceDistanceFromBottom).toBeLessThanOrEqual(expectedDistanceFromBottom + 10);
        
        expect(toolbarDistanceFromBottom).toBeGreaterThanOrEqual(expectedDistanceFromBottom - 5);
        expect(toolbarDistanceFromBottom).toBeLessThanOrEqual(expectedDistanceFromBottom + 10);
      }
    }
  });
});
