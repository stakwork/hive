import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Onboarding Workspace Wizard
 */
export class OnboardingPage {
  constructor(private page: Page) {}

  /**
   * Navigate to onboarding workspace page
   */
  async goto(): Promise<void> {
    await this.page.goto('http://localhost:3000/onboarding/workspace');
  }

  /**
   * Wait for the onboarding page to load
   */
  async waitForLoad(): Promise<void> {
    // Wait for the repository URL input to be visible as a unique identifier
    await waitForElement(this.page, selectors.onboarding.repositoryUrlInput);
  }

  /**
   * Enter repository URL in the input field
   */
  async enterRepositoryUrl(url: string): Promise<void> {
    const input = this.page.locator(selectors.onboarding.repositoryUrlInput);
    await expect(input).toBeVisible();
    await input.fill(url);
  }

  /**
   * Click the Get Started button
   */
  async clickGetStarted(): Promise<void> {
    const button = this.page.locator(selectors.onboarding.getStartedButton);
    await expect(button).toBeEnabled();
    await button.click();
  }

  /**
   * Wait for the project name setup step to load
   */
  async waitForProjectNameStep(): Promise<void> {
    await waitForElement(this.page, selectors.onboarding.projectNameInput, { timeout: 10000 });
  }

  /**
   * Enter project name in the input field
   */
  async enterProjectName(name: string): Promise<void> {
    const input = this.page.locator(selectors.onboarding.projectNameInput);
    await expect(input).toBeVisible();
    await input.fill(name);
  }

  /**
   * Click the Create button
   */
  async clickCreate(): Promise<void> {
    const button = this.page.locator(selectors.onboarding.createButton);
    await expect(button).toBeEnabled();
    await button.click();
  }

  /**
   * Get the current value of the project name input
   */
  async getProjectNameValue(): Promise<string> {
    const input = this.page.locator(selectors.onboarding.projectNameInput);
    return await input.inputValue();
  }
}
