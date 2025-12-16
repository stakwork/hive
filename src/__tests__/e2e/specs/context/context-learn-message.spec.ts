import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage, DashboardPage, ContextLearnPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * Context Learn page message sending tests
 * Tests user journey for navigating to and sending messages in the Context Learn page
 */
test.describe('Send message in Context Learn page', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let contextLearnPage: ContextLearnPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    contextLearnPage = new ContextLearnPage(page);

    // Authenticate and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test('should navigate to Context Learn page via sidebar', async ({ page }) => {
    // Navigate to Context Learn page via sidebar
    await contextLearnPage.navigateViaNavigation();

    // Verify we're on the Context Learn page
    await expect(page).toHaveURL(/\/w\/.*\/learn/, { timeout: 10000 });

    // Verify the message input is visible
    const isInputVisible = await contextLearnPage.isMessageInputVisible();
    expect(isInputVisible).toBe(true);
  });

  test('should display message input and send button', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Verify message input is visible
    const isInputVisible = await contextLearnPage.isMessageInputVisible();
    expect(isInputVisible).toBe(true);

    // Verify send button is visible
    const isSendButtonVisible = await contextLearnPage.isSendButtonVisible();
    expect(isSendButtonVisible).toBe(true);
  });

  test('should send a message in Context Learn page', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Send a message
    const testMessage = 'hi there!';
    await contextLearnPage.sendMessage(testMessage);

    // Verify the message input is cleared after sending
    const inputValue = await contextLearnPage.getMessageInputValue();
    expect(inputValue).toBe('');

    // Verify the send button remains visible (for sending more messages)
    const isSendButtonVisible = await contextLearnPage.isSendButtonVisible();
    expect(isSendButtonVisible).toBe(true);
  });

  test('should complete full user journey: dashboard -> Context Learn -> send message', async ({ page }) => {
    // Starting from dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible({ timeout: 30000 });

    // Navigate to Context Learn via sidebar
    await contextLearnPage.navigateViaNavigation();

    // Verify we're on Context Learn page
    await expect(page).toHaveURL(/\/w\/.*\/learn/);

    // Verify message input is present
    await expect(page.locator(selectors.learn.messageInput)).toBeVisible();

    // Send a message
    const testMessage = 'hi there!';
    await contextLearnPage.sendMessage(testMessage);

    // Verify the input is cleared after sending
    const inputValue = await contextLearnPage.getMessageInputValue();
    expect(inputValue).toBe('');
  });

  test('should not allow sending empty messages', async ({ page }) => {
    // Navigate to Context Learn page
    await contextLearnPage.goto(workspaceSlug);

    // Try to send an empty message
    const sendButton = page.locator(selectors.learn.messageSend);
    
    // Verify send button is initially disabled (no text entered)
    await expect(sendButton).toBeDisabled();

    // Fill with whitespace only
    const messageInput = page.locator(selectors.learn.messageInput);
    await messageInput.fill('   ');

    // Verify send button is still disabled
    await expect(sendButton).toBeDisabled();

    // Fill with actual content
    await messageInput.fill('valid message');

    // Verify send button is now enabled
    await expect(sendButton).toBeEnabled();
  });
});
