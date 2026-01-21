import { test, expect } from '@playwright/test';
import { AuthPage, DashboardPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

/**
 * Bottom Bar Alignment Tests
 * 
 * Tests for the alignment and layout stability of bottom bar elements:
 * - WorkspaceMembersPreview (left)
 * - DashboardChat (center)
 * - ActionsToolbar (right)
 */
test.describe('Bottom Bar Alignment', () => {
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

  test('all three bottom bar elements should align at same vertical position', async ({ page }) => {
    // Wait for all bottom bar elements to be visible
    const membersPreview = page.locator('[data-testid="workspace-members-preview"]');
    const dashboardChat = page.locator('[data-testid="dashboard-chat"]');
    const actionsToolbar = page.locator('#actions-toolbar');

    await expect(membersPreview).toBeVisible({ timeout: 10000 });
    await expect(dashboardChat).toBeVisible({ timeout: 10000 });
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    // Get bounding boxes for all elements
    const membersBox = await membersPreview.boundingBox();
    const chatBox = await dashboardChat.boundingBox();
    const actionsBox = await actionsToolbar.boundingBox();

    expect(membersBox).not.toBeNull();
    expect(chatBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();

    if (!membersBox || !chatBox || !actionsBox) return;

    // Calculate bottom positions (y + height)
    const membersBottom = membersBox.y + membersBox.height;
    const chatBottom = chatBox.y + chatBox.height;
    const actionsBottom = actionsBox.y + actionsBox.height;

    // All elements should have same bottom position (within 5px tolerance for rounding)
    expect(Math.abs(membersBottom - chatBottom)).toBeLessThan(5);
    expect(Math.abs(chatBottom - actionsBottom)).toBeLessThan(5);
  });

  test('chat input should maintain alignment when textarea expands', async ({ page }) => {
    const dashboardChat = page.locator('[data-testid="dashboard-chat"]');
    const chatInput = page.locator('[data-testid="dashboard-chat-input"]');

    await expect(dashboardChat).toBeVisible({ timeout: 10000 });
    await expect(chatInput).toBeVisible();

    // Get initial position
    const initialBox = await dashboardChat.boundingBox();
    expect(initialBox).not.toBeNull();
    if (!initialBox) return;

    // Type long text to expand textarea
    await chatInput.fill('This is a very long message that should cause the textarea to expand to multiple lines. We want to verify that the alignment remains stable when this happens.');

    // Wait for textarea to expand
    await page.waitForTimeout(200);

    // Get position after expansion
    const expandedBox = await dashboardChat.boundingBox();
    expect(expandedBox).not.toBeNull();
    if (!expandedBox) return;

    // Bottom position should remain the same (height grows upward)
    const bottomDiff = Math.abs((initialBox.y + initialBox.height) - (expandedBox.y + expandedBox.height));
    expect(bottomDiff).toBeLessThan(5);
  });

  test('all bottom bar elements should maintain 16px spacing from viewport edges', async ({ page }) => {
    const membersPreview = page.locator('[data-testid="workspace-members-preview"]');
    const actionsToolbar = page.locator('#actions-toolbar');

    await expect(membersPreview).toBeVisible({ timeout: 10000 });
    await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();
    if (!viewportSize) return;

    // Get bounding boxes
    const membersBox = await membersPreview.boundingBox();
    const actionsBox = await actionsToolbar.boundingBox();

    expect(membersBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    if (!membersBox || !actionsBox) return;

    // Check left spacing (16px = bottom-4)
    expect(membersBox.x).toBeCloseTo(16, 2);

    // Check right spacing (16px = bottom-4)
    const rightEdge = actionsBox.x + actionsBox.width;
    expect(viewportSize.width - rightEdge).toBeCloseTo(16, 2);

    // Check bottom spacing (16px = bottom-4)
    const membersBottom = viewportSize.height - (membersBox.y + membersBox.height);
    const actionsBottom = viewportSize.height - (actionsBox.y + actionsBox.height);
    expect(membersBottom).toBeCloseTo(16, 2);
    expect(actionsBottom).toBeCloseTo(16, 2);
  });

  test('chat width should respond to viewport resize', async ({ page }) => {
    const dashboardChat = page.locator('[data-testid="dashboard-chat"]');
    await expect(dashboardChat).toBeVisible({ timeout: 10000 });

    // Get initial width at default viewport
    const initialBox = await dashboardChat.boundingBox();
    expect(initialBox).not.toBeNull();
    if (!initialBox) return;
    const initialWidth = initialBox.width;

    // Resize viewport to wider
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300); // Wait for resize handler

    // Get new width
    const widerBox = await dashboardChat.boundingBox();
    expect(widerBox).not.toBeNull();
    if (!widerBox) return;
    const widerWidth = widerBox.width;

    // Chat should be wider on larger viewport
    expect(widerWidth).toBeGreaterThan(initialWidth);

    // Resize viewport to narrower
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300); // Wait for resize handler

    // Get narrower width
    const narrowerBox = await dashboardChat.boundingBox();
    expect(narrowerBox).not.toBeNull();
    if (!narrowerBox) return;
    const narrowerWidth = narrowerBox.width;

    // Chat should be narrower on smaller viewport
    expect(narrowerWidth).toBeLessThan(widerWidth);
  });

  test('layout should remain stable when WorkspaceMembersPreview expands', async ({ page }) => {
    const membersPreview = page.locator('[data-testid="workspace-members-preview"]');
    const expandButton = membersPreview.locator('button[aria-label="Expand"]');
    const dashboardChat = page.locator('[data-testid="dashboard-chat"]');

    await expect(membersPreview).toBeVisible({ timeout: 10000 });

    // Get initial positions
    const initialMembersBox = await membersPreview.boundingBox();
    const initialChatBox = await dashboardChat.boundingBox();
    expect(initialMembersBox).not.toBeNull();
    expect(initialChatBox).not.toBeNull();
    if (!initialMembersBox || !initialChatBox) return;

    // Check if expand button exists (only if there are more members)
    const hasExpandButton = await expandButton.count() > 0;
    
    if (hasExpandButton) {
      // Expand members preview
      await expandButton.click();
      await page.waitForTimeout(400); // Wait for animation

      // Get positions after expansion
      const expandedMembersBox = await membersPreview.boundingBox();
      const expandedChatBox = await dashboardChat.boundingBox();
      expect(expandedMembersBox).not.toBeNull();
      expect(expandedChatBox).not.toBeNull();
      if (!expandedMembersBox || !expandedChatBox) return;

      // Members preview width should not exceed 280px (max-w-[280px])
      expect(expandedMembersBox.width).toBeLessThanOrEqual(280);

      // Chat position should remain stable (centered)
      const initialChatCenter = initialChatBox.x + initialChatBox.width / 2;
      const expandedChatCenter = expandedChatBox.x + expandedChatBox.width / 2;
      expect(Math.abs(initialChatCenter - expandedChatCenter)).toBeLessThan(5);

      // Bottom alignment should remain consistent
      const initialMembersBottom = initialMembersBox.y + initialMembersBox.height;
      const expandedMembersBottom = expandedMembersBox.y + expandedMembersBox.height;
      expect(Math.abs(initialMembersBottom - expandedMembersBottom)).toBeLessThan(5);
    }
  });

  test('elements should not overlap at various viewport sizes', async ({ page }) => {
    const viewportSizes = [
      { width: 1920, height: 1080, name: 'Desktop Large' },
      { width: 1366, height: 768, name: 'Desktop Medium' },
      { width: 1024, height: 768, name: 'Tablet Landscape' },
    ];

    for (const size of viewportSizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300); // Wait for resize handler

      const membersPreview = page.locator('[data-testid="workspace-members-preview"]');
      const dashboardChat = page.locator('[data-testid="dashboard-chat"]');
      const actionsToolbar = page.locator('#actions-toolbar');

      await expect(membersPreview).toBeVisible({ timeout: 10000 });
      await expect(dashboardChat).toBeVisible({ timeout: 10000 });
      await expect(actionsToolbar).toBeVisible({ timeout: 10000 });

      const membersBox = await membersPreview.boundingBox();
      const chatBox = await dashboardChat.boundingBox();
      const actionsBox = await actionsToolbar.boundingBox();

      expect(membersBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(actionsBox).not.toBeNull();
      if (!membersBox || !chatBox || !actionsBox) continue;

      // Check no overlap between members and chat
      const membersRight = membersBox.x + membersBox.width;
      const chatLeft = chatBox.x;
      expect(chatLeft).toBeGreaterThan(membersRight);

      // Check no overlap between chat and actions
      const chatRight = chatBox.x + chatBox.width;
      const actionsLeft = actionsBox.x;
      expect(actionsLeft).toBeGreaterThan(chatRight);
    }
  });

  test('chat input buttons should align at top edge with textarea', async ({ page }) => {
    const chatInput = page.locator('[data-testid="dashboard-chat-input"]');
    const imageButton = page.locator('button[title*="image"]').first();
    const submitButton = page.locator('button[type="submit"]').last();

    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // Type multi-line text to expand textarea
    await chatInput.fill('Line 1\nLine 2\nLine 3\nLine 4');
    await page.waitForTimeout(200);

    // Get positions of elements
    const inputBox = await chatInput.boundingBox();
    const imageButtonBox = await imageButton.boundingBox();
    const submitButtonBox = await submitButton.boundingBox();

    expect(inputBox).not.toBeNull();
    expect(imageButtonBox).not.toBeNull();
    expect(submitButtonBox).not.toBeNull();
    if (!inputBox || !imageButtonBox || !submitButtonBox) return;

    // All elements should align at the top (items-start behavior)
    // Allow small tolerance for padding/borders
    expect(Math.abs(inputBox.y - imageButtonBox.y)).toBeLessThan(10);
    
    // Submit button is inside the textarea container, so check relative alignment
    expect(submitButtonBox.y).toBeGreaterThanOrEqual(inputBox.y);
    expect(submitButtonBox.y).toBeLessThan(inputBox.y + 50); // Should be near top
  });
});
