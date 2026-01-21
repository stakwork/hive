import { expect } from "@playwright/test";
import { test } from "@/__tests__/e2e/support/fixtures/test-hooks";
import { AuthPage, WorkspaceSettingsPage } from "@/__tests__/e2e/support/page-objects";
import { selectors } from "@/__tests__/e2e/support/fixtures/selectors";

test.describe("Vercel Integration Settings", () => {
  test("displays Vercel integration card with all form fields", async ({ page }) => {
    // Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug from the current URL
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();

    // Navigate to workspace settings
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Verify the card is visible
    const card = page.locator(selectors.vercelIntegration.card);
    await expect(card).toBeVisible();

    // Check title and description
    await expect(card.locator("text=Vercel Integration")).toBeVisible();
    await expect(card.locator("text=Monitor production logs in real-time")).toBeVisible();

    // Wait for loading to complete
    await expect(page.locator(selectors.vercelIntegration.loading)).not.toBeVisible({ timeout: 10000 });

    // Verify API Token input
    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    await expect(apiTokenInput).toBeVisible();
    await expect(apiTokenInput).toHaveAttribute("type", "password");
    await expect(apiTokenInput).toHaveAttribute("placeholder", "Enter your Vercel API token");

    // Verify Team ID input
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    await expect(teamIdInput).toBeVisible();
    await expect(teamIdInput).toHaveAttribute("type", "text");
    await expect(teamIdInput).toHaveAttribute("placeholder", "Enter your Vercel team ID");

    // Verify Webhook URL input (read-only)
    const webhookUrlInput = page.locator(selectors.vercelIntegration.webhookUrlInput);
    await expect(webhookUrlInput).toBeVisible();

    // Verify Copy button
    const copyButton = page.locator(selectors.vercelIntegration.webhookUrlCopyButton);
    await expect(copyButton).toBeVisible();

    // Verify Setup instructions
    const instructions = page.locator(selectors.vercelIntegration.setupInstructions);
    await expect(instructions).toBeVisible();
    await expect(instructions.locator("li")).toHaveCount(4);

    // Verify Save button is visible and initially disabled
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled();
  });

  test("enables save button when API token is entered and saves successfully", async ({ page }) => {
    // Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug and navigate to settings
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Wait for loading to complete
    await expect(page.locator(selectors.vercelIntegration.loading)).not.toBeVisible({ timeout: 10000 });

    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Initially save button should be disabled
    await expect(saveButton).toBeDisabled();

    // Enter API token
    await apiTokenInput.fill("test_vercel_api_token_xyz");
    await teamIdInput.fill("team_test_123");

    // Save button should now be enabled
    await expect(saveButton).toBeEnabled();

    // Click save
    await saveButton.click();

    // Check for success toast
    await expect(page.locator("text=Vercel integration settings saved successfully")).toBeVisible({ timeout: 5000 });

    // Save button should be disabled again (no changes)
    await expect(saveButton).toBeDisabled();
  });

  test("team ID is optional for saving", async ({ page }) => {
    // Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug and navigate to settings
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Wait for loading to complete
    await expect(page.locator(selectors.vercelIntegration.loading)).not.toBeVisible({ timeout: 10000 });

    const apiTokenInput = page.locator(selectors.vercelIntegration.apiTokenInput);
    const teamIdInput = page.locator(selectors.vercelIntegration.teamIdInput);
    const saveButton = page.locator(selectors.vercelIntegration.saveButton);

    // Fill only API token (team ID empty)
    await apiTokenInput.fill("personal_account_token");

    // Save button should be enabled
    await expect(saveButton).toBeEnabled();

    // Save successfully without team ID
    await saveButton.click();
    await expect(page.locator("text=Vercel integration settings saved successfully")).toBeVisible({ timeout: 5000 });

    // Verify team ID is still empty
    await expect(teamIdInput).toHaveValue("");
  });

  test("copies webhook URL to clipboard", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Get the workspace slug and navigate to settings
    const workspaceSlug = authPage.getCurrentWorkspaceSlug();
    const settingsPage = new WorkspaceSettingsPage(page);
    await settingsPage.goto(workspaceSlug);

    // Wait for loading to complete
    await expect(page.locator(selectors.vercelIntegration.loading)).not.toBeVisible({ timeout: 10000 });

    const webhookUrlInput = page.locator(selectors.vercelIntegration.webhookUrlInput);
    const copyButton = page.locator(selectors.vercelIntegration.webhookUrlCopyButton);

    // Get webhook URL value
    const webhookUrl = await webhookUrlInput.inputValue();
    expect(webhookUrl).toBeTruthy();
    expect(webhookUrl).toContain("/api/workspaces/");
    expect(webhookUrl).toContain("/webhooks/vercel");

    // Click copy button
    await copyButton.click();

    // Check for success toast
    await expect(page.locator("text=Webhook URL copied to clipboard")).toBeVisible({ timeout: 3000 });

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(webhookUrl);
  });
});
