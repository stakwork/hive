import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { OnboardingPage } from '@/__tests__/e2e/support/page-objects';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';
import { expect } from '@playwright/test';

test.describe('Onboarding Wizard Flow', () => {
  let onboardingPage: OnboardingPage;

  test.beforeEach(async ({ page }) => {
    onboardingPage = new OnboardingPage(page);
  });

  test('should complete full 3-step onboarding flow without authentication', async () => {
    // Navigate to onboarding
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Step 1: Welcome - Verify and complete
    await onboardingPage.verifyWelcomeStepVisible();
    const testRepoUrl = 'https://github.com/test-org/test-repo';
    await onboardingPage.completeWelcomeStep(testRepoUrl);

    // Step 2: GitHub Auth - Verify and complete
    await onboardingPage.verifyGithubAuthStepVisible();
    await onboardingPage.completeGithubAuthStep();

    // Step 3: Project Name - Verify and complete
    await onboardingPage.verifyProjectNameStepVisible();
    const testProjectName = `test-workspace-${Date.now()}`;
    await onboardingPage.completeProjectNameStep(testProjectName);

    // Verify completion - should redirect to workspace
    await onboardingPage.verifyOnboardingComplete();
  });

  test('should display welcome step on initial load', async () => {
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();
    
    const currentStep = await onboardingPage.getCurrentStep();
    expect(currentStep).toBe('welcome');
    
    await onboardingPage.verifyWelcomeStepVisible();
  });

  test('should validate repository URL on welcome step', async ({ page }) => {
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Try with invalid URL
    const repoInput = page.locator(selectors.onboarding.repoUrlInput);
    const getStartedButton = page.locator(selectors.onboarding.getStartedButton);

    // Empty input - button should be disabled
    await expect(getStartedButton).toBeDisabled();

    // Invalid URL format
    await repoInput.fill('not-a-valid-url');
    await getStartedButton.click();
    
    // Should show error message
    await expect(page.locator('text=/valid GitHub repository/i')).toBeVisible();
  });

  test('should persist repository URL between steps', async ({ page }) => {
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    const testRepoUrl = 'https://github.com/test-org/persist-test';
    
    // Complete welcome step
    await onboardingPage.completeWelcomeStep(testRepoUrl);
    
    // Verify localStorage has the repo URL
    const storedUrl = await page.evaluate(() => localStorage.getItem('repoUrl'));
    expect(storedUrl).toBe(testRepoUrl);
  });

  test('should allow canceling during project name step', async ({ page }) => {
    await onboardingPage.goto();
    await onboardingPage.waitForLoad();

    // Complete steps 1 and 2
    await onboardingPage.completeWelcomeStep('https://github.com/test-org/cancel-test');
    await onboardingPage.completeGithubAuthStep();

    // On project name step, click cancel
    await onboardingPage.verifyProjectNameStepVisible();
    const cancelButton = page.locator(selectors.onboarding.cancelButton);
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Should redirect back to welcome step
    await onboardingPage.verifyWelcomeStepVisible();
  });
});

