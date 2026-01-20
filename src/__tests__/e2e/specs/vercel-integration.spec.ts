import { test, expect } from '@playwright/test';
import { AuthPage } from '../support/page-objects/AuthPage';
import { createWorkspaceFixture } from '../support/fixtures/workspace';
import { selectors } from '../support/fixtures/selectors';

test.describe('Vercel Integration Settings', () => {
  let authPage: AuthPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);

    // Sign in with mock auth
    await authPage.goto();
    await authPage.signInWithMock();

    // Create a workspace for testing
    const workspace = await createWorkspaceFixture(page, {
      name: 'Vercel Test Workspace',
      role: 'OWNER',
    });
    workspaceSlug = workspace.slug;

    // Navigate to settings page
    await page.goto(`http://localhost:3000/w/${workspaceSlug}/settings`);
    await page.waitForLoadState('networkidle');
  });

  test('displays Vercel integration card', async ({ page }) => {
    const card = page.locator(selectors.vercelIntegration.card);
    await expect(card).toBeVisible();

    // Check title and description
    await expect(card.locator('text=Vercel Integration')).toBeVisible();
    await expect(card.locator('text=Monitor production logs in real-time')).toBeVisible();
  });

  test('displays all form fields', async ({ page }) => {
    // API Token input
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    await expect(apiTokenInput).toBeVisible();
    await expect(apiTokenInput).toHaveAttribute('type', 'password');
    await expect(apiTokenInput).toHaveAttribute('placeholder', 'Enter your Vercel API token');

    // Team ID input
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    await expect(teamIdInput).toBeVisible();
    await expect(teamIdInput).toHaveAttribute('type', 'text');
    await expect(teamIdInput).toHaveAttribute('placeholder', 'Enter your Vercel team ID');

    // Webhook URL input (read-only)
    const webhookUrlInput = page.locator(selectors.vercelIntegration.webhookUrlInput);
    await expect(webhookUrlInput).toBeVisible();
    await expect(webhookUrlInput).toHaveAttribute('readonly');

    // Copy button
    const copyButton = page.locator(selectors.vercelIntegration.webhookUrlCopyButton);
    await expect(copyButton).toBeVisible();

    // Setup instructions
    const instructions = page.locator(selectors.vercelIntegration.setupInstructions);
    await expect(instructions).toBeVisible();
    await expect(instructions.locator('li')).toHaveCount(4);

    // Save button
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled(); // Initially disabled with no changes
  });

  test('enables save button when API token is entered', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Initially disabled
    await expect(saveButton).toBeDisabled();

    // Enter API token
    await apiTokenInput.fill('test_vercel_token_123');

    // Save button should now be enabled
    await expect(saveButton).toBeEnabled();
  });

  test('copies webhook URL to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const webhookUrlInput = page.locator(selectors.vercelIntegration.webhookUrlInput);
    const copyButton = page.locator(selectors.vercelIntegration.webhookUrlCopyButton);

    // Get webhook URL value
    const webhookUrl = await webhookUrlInput.inputValue();
    expect(webhookUrl).toBeTruthy();
    expect(webhookUrl).toContain('/api/workspaces/');
    expect(webhookUrl).toContain('/webhooks/vercel');

    // Click copy button
    await copyButton.click();

    // Check for success toast
    await expect(page.locator('text=Webhook URL copied to clipboard')).toBeVisible({ timeout: 3000 });

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(webhookUrl);
  });

  test('saves Vercel integration settings', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Fill in form
    await apiTokenInput.fill('test_vercel_api_token_xyz');
    await teamIdInput.fill('team_test_123');

    // Save button should be enabled
    await expect(saveButton).toBeEnabled();

    // Click save
    await saveButton.click();

    // Check for success toast
    await expect(page.locator('text=Vercel integration settings saved successfully')).toBeVisible({ timeout: 5000 });

    // Save button should be disabled again (no changes)
    await expect(saveButton).toBeDisabled();
  });

  test('validates required API token', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Fill and then clear API token
    await apiTokenInput.fill('token');
    await apiTokenInput.clear();

    // Save button should be disabled
    await expect(saveButton).toBeDisabled();
  });

  test('loads existing settings', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Save some settings first
    await apiTokenInput.fill('existing_token_123');
    await teamIdInput.fill('existing_team_456');
    await saveButton.click();
    await expect(page.locator('text=Vercel integration settings saved successfully')).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check that settings are loaded
    await expect(apiTokenInput).toHaveValue('existing_token_123');
    await expect(teamIdInput).toHaveValue('existing_team_456');

    // Save button should be disabled (no changes)
    await expect(saveButton).toBeDisabled();
  });

  test('team ID is optional', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Fill only API token (team ID empty)
    await apiTokenInput.fill('personal_account_token');

    // Save button should be enabled
    await expect(saveButton).toBeEnabled();

    // Save successfully without team ID
    await saveButton.click();
    await expect(page.locator('text=Vercel integration settings saved successfully')).toBeVisible({ timeout: 5000 });

    // Verify team ID is still empty
    await expect(teamIdInput).toHaveValue('');
  });

  test('disables form during save', async ({ page }) => {
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Fill form
    await apiTokenInput.fill('test_token');

    // Intercept the API call to delay it
    await page.route('**/api/workspaces/*/settings/vercel-integration', async (route) => {
      // Delay the response
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    // Click save
    await saveButton.click();

    // Check that inputs are disabled during save
    await expect(apiTokenInput).toBeDisabled();
    await expect(teamIdInput).toBeDisabled();
    await expect(saveButton).toHaveText('Saving...');

    // Wait for save to complete
    await expect(page.locator('text=Vercel integration settings saved successfully')).toBeVisible({ timeout: 5000 });
  });

  test('hides card for non-admin users', async ({ page }) => {
    // Create a workspace with DEVELOPER role
    const devWorkspace = await createWorkspaceFixture(page, {
      name: 'Dev Workspace',
      role: 'DEVELOPER',
    });

    // Navigate to settings
    await page.goto(`http://localhost:3000/w/${devWorkspace.slug}/settings`);
    await page.waitForLoadState('networkidle');

    // Vercel integration card should not be visible
    const card = page.locator(selectors.vercelIntegration.card);
    await expect(card).not.toBeVisible();
  });

  test('shows card for admin users', async ({ page }) => {
    // Create a workspace with ADMIN role
    const adminWorkspace = await createWorkspaceFixture(page, {
      name: 'Admin Workspace',
      role: 'ADMIN',
    });

    // Navigate to settings
    await page.goto(`http://localhost:3000/w/${adminWorkspace.slug}/settings`);
    await page.waitForLoadState('networkidle');

    // Vercel integration card should be visible
    const card = page.locator(selectors.vercelIntegration.card);
    await expect(card).toBeVisible();
  });
});
