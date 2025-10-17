import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';
import { assertVisible, assertURLPattern } from '@/__tests__/e2e/support/helpers/assertions';

/**
 * E2E Test: Authentication Sign-In User Journey
 * 
 * Tests the complete sign-in flow including navigation to/from the sign-in page
 * Follows best practices: uses page objects, selectors, helpers, and test hooks
 */
test.describe('Authentication Sign-In Journey', () => {
  let authPage: AuthPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
  });

  test('should navigate from signin page back to home using "Back to Home" link', async ({ page }) => {
    // Step 1: Navigate to sign-in page
    await authPage.gotoSignIn();
    
    // Step 2: Verify we're on signin page
    assertURLPattern(page, /\/auth\/signin/);
    await assertVisible(page, selectors.auth.backToHomeLink);

    // Step 3: Click "Back to Home" link
    await authPage.clickBackToHome();

    // Step 4: Verify we're redirected to home/root page
    await page.waitForURL('http://localhost:3000/', { timeout: 10000 });
    expect(page.url()).toBe('http://localhost:3000/');
  });

  test('should display signin button and validate page elements', async ({ page }) => {
    // Step 1: Go directly to signin page
    await authPage.gotoSignIn();

    // Step 2: Verify all key signin page elements
    await assertVisible(page, selectors.auth.signinPageTitle);
    await assertVisible(page, selectors.auth.mockSignInButton);
    await assertVisible(page, selectors.auth.backToHomeLink);

    // Step 3: Verify button text content
    const mockSignInBtn = page.locator(selectors.auth.mockSignInButton);
    await expect(mockSignInBtn).toContainText(/Mock Sign In/i);

    // Step 4: Verify back link text
    const backLink = page.locator(selectors.auth.backToHomeLink);
    await expect(backLink).toContainText(/Back to Home/i);
  });
});
