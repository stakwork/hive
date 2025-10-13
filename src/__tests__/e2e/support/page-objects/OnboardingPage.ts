import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Onboarding Wizard
 * Handles the 3-step onboarding flow: Welcome → GitHub Auth → Project Name
 */
export class OnboardingPage {
  constructor(private page: Page) {}

  /**
   * Navigate to onboarding wizard
   */
  async goto(): Promise<void> {
    await this.page.goto('http://localhost:3000/onboarding/workspace');
  }

  /**
   * Wait for the onboarding page to load
   */
  async waitForLoad(): Promise<void> {
    // Wait for any of the step containers to be visible
    await this.page.waitForSelector(
      `${selectors.onboarding.welcomeStep}, ${selectors.onboarding.githubAuthStep}, ${selectors.onboarding.projectNameStep}`,
      { timeout: 10000 }
    );
  }

  /**
   * Complete the Welcome step (Step 1)
   * @param repoUrl - GitHub repository URL
   */
  async completeWelcomeStep(repoUrl: string): Promise<void> {
    // Wait for welcome step to be visible
    await waitForElement(this.page, selectors.onboarding.welcomeStep);
    
    // Fill in repository URL
    const repoInput = this.page.locator(selectors.onboarding.repoUrlInput);
    await expect(repoInput).toBeVisible();
    await repoInput.fill(repoUrl);
    
    // Click Get Started button
    const getStartedButton = this.page.locator(selectors.onboarding.getStartedButton);
    await expect(getStartedButton).toBeEnabled();
    await getStartedButton.click();
  }

  /**
   * Complete the GitHub Auth step (Step 2)
   * Uses mock authentication for testing
   */
  async completeGithubAuthStep(): Promise<void> {
    // Wait for GitHub auth step to be visible
    await waitForElement(this.page, selectors.onboarding.githubAuthStep);
    
    // Click GitHub sign-in button (uses mock auth in test environment)
    const githubButton = this.page.locator(selectors.auth.githubSignInButton);
    await expect(githubButton).toBeVisible();
    await githubButton.click();
    
    // Wait for authentication to complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Complete the Project Name step (Step 3)
   * @param projectName - Workspace name
   */
  async completeProjectNameStep(projectName: string): Promise<void> {
    // Wait for project name step to be visible
    await waitForElement(this.page, selectors.onboarding.projectNameStep);
    
    // Fill in project name
    const projectInput = this.page.locator(selectors.onboarding.projectNameInput);
    await expect(projectInput).toBeVisible();
    await projectInput.fill(projectName);
    
    // Click Create button
    const createButton = this.page.locator(selectors.onboarding.createButton);
    await expect(createButton).toBeEnabled();
    await createButton.click();
  }

  /**
   * Verify welcome step is visible
   */
  async verifyWelcomeStepVisible(): Promise<void> {
    await expect(this.page.locator(selectors.onboarding.welcomeStep)).toBeVisible();
    await expect(this.page.locator(selectors.onboarding.repoUrlInput)).toBeVisible();
  }

  /**
   * Verify GitHub auth step is visible
   */
  async verifyGithubAuthStepVisible(): Promise<void> {
    await expect(this.page.locator(selectors.onboarding.githubAuthStep)).toBeVisible();
    await expect(this.page.locator(selectors.auth.githubSignInButton)).toBeVisible();
  }

  /**
   * Verify project name step is visible
   */
  async verifyProjectNameStepVisible(): Promise<void> {
    await expect(this.page.locator(selectors.onboarding.projectNameStep)).toBeVisible();
    await expect(this.page.locator(selectors.onboarding.projectNameInput)).toBeVisible();
  }

  /**
   * Verify onboarding completion (redirected to workspace)
   */
  async verifyOnboardingComplete(): Promise<void> {
    // Should be redirected to workspace dashboard
    await this.page.waitForURL(/\/w\/.*/, { timeout: 30000 });
  }

  /**
   * Get current step from the page
   */
  async getCurrentStep(): Promise<'welcome' | 'github-auth' | 'project-name' | 'unknown'> {
    const welcomeVisible = await this.page.locator(selectors.onboarding.welcomeStep).isVisible();
    if (welcomeVisible) return 'welcome';
    
    const githubAuthVisible = await this.page.locator(selectors.onboarding.githubAuthStep).isVisible();
    if (githubAuthVisible) return 'github-auth';
    
    const projectNameVisible = await this.page.locator(selectors.onboarding.projectNameStep).isVisible();
    if (projectNameVisible) return 'project-name';
    
    return 'unknown';
  }
}
