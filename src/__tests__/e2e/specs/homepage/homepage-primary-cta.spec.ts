/**
 * E2E Test: Homepage Primary CTA Click
 *
 * Tests the primary CTA (Call-to-Action) button on the homepage.
 * Since the homepage redirects to /auth/signin when no session exists,
 * this test validates the mock sign-in flow.
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage } from '@/__tests__/e2e/support/page-objects';

test.describe('Homepage Primary CTA', () => {
  test('should redirect to auth page and allow mock sign-in', async ({ page }) => {
    const authPage = new AuthPage(page);

    // Navigate to homepage
    await authPage.goto();

    // Homepage should redirect to /auth/signin
    await page.waitForURL(/\/auth\/signin/, { timeout: 10000 });
    expect(page.url()).toContain('/auth/signin');

    // Click the primary CTA (mock sign-in button)
    await authPage.signInWithMock();

    // Should redirect to a workspace
    await page.waitForURL(/\/w\/.*/, { timeout: 10000 });
    expect(page.url()).toMatch(/\/w\/[^/]+/);

    // Verify authenticated state
    await authPage.verifyAuthenticated();
  });

  test('should display welcome message before sign-in', async ({ page }) => {
    const authPage = new AuthPage(page);

    // Navigate to homepage
    await authPage.goto();

    // Wait for redirect to auth page
    await page.waitForURL(/\/auth\/signin/, { timeout: 10000 });

    // Verify welcome message or sign-in UI is visible
    const signInButton = page.locator('[data-testid="mock-signin-button"]');
    await expect(signInButton).toBeVisible({ timeout: 10000 });
  });
});
