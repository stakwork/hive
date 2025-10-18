import { expect } from '@playwright/test';
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, OnboardingPage } from '@/__tests__/e2e/support/page-objects';

test.describe('Onboarding - Add Repository Flow', () => {
  test('should successfully complete onboarding with repository URL', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Navigate to onboarding page to test the flow
    const onboardingPage = new OnboardingPage(page);
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Act - Enter repository URL
    const testRepoUrl = 'https://github.com/stakwork/kotlin-sample-app';
    await onboardingPage.enterRepositoryUrl(testRepoUrl);

    // Click Get Started - this saves to localStorage
    await onboardingPage.clickGetStarted();

    // Wait for navigation and add delay for wizard state to settle
    await page.waitForTimeout(2000);

    // The wizard auto-advances to PROJECT_NAME step when user is logged in and repoUrl is set
    // Wait for project name step to load with increased timeout
    await page.waitForSelector('input#graphDomain', { state: 'visible', timeout: 15000 });

    // Assert - Verify project name is auto-populated from repo name
    const projectName = await onboardingPage.getProjectNameValue();
    expect(projectName).toBeTruthy();
    expect(projectName.toLowerCase()).toContain('kotlin-sample-app');

    // Act - Click Create to complete onboarding
    await onboardingPage.clickCreate();

    // Assert - Verify redirect to workspace dashboard or GitHub App setup
    // After creating workspace, should redirect to either:
    // 1. /w/{slug} (dashboard) if GitHub App already installed
    // 2. GitHub App installation page if not installed
    await page.waitForURL(/(\/w\/[^/]+|github\.com)/i, { timeout: 15000 });
    
    const currentUrl = page.url();
    const isWorkspaceDashboard = /\/w\/[^/]+/.test(currentUrl);
    const isGitHubAppSetup = /github\.com/.test(currentUrl);
    
    expect(isWorkspaceDashboard || isGitHubAppSetup).toBeTruthy();
  });

  test('should show validation error for invalid repository URL', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Navigate to onboarding page
    const onboardingPage = new OnboardingPage(page);
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Act - Enter invalid repository URL
    await onboardingPage.enterRepositoryUrl('not-a-valid-url');
    await onboardingPage.clickGetStarted();

    // Assert - Error message should be visible
    await expect(page.locator('text=/valid GitHub repository URL/i')).toBeVisible();
  });

  test('should require repository URL to proceed', async ({ page }) => {
    // Arrange - Sign in with mock authentication
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Navigate to onboarding page
    const onboardingPage = new OnboardingPage(page);
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Act - Try to click Get Started without entering URL
    // Button should be disabled when input is empty
    const getStartedButton = page.locator('[data-testid="onboarding-get-started-button"]');
    await expect(getStartedButton).toBeDisabled();
  });
});
