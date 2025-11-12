import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Stakgraph Configuration page
 * Encapsulates all stakgraph interactions and assertions
 */
export class StakgraphPage {
  constructor(private page: Page) {}

  /**
   * Navigate to stakgraph page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/stakgraph`);
    await this.waitForLoad();
  }

  /**
   * Wait for stakgraph page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.stakgraph.pageTitle)).toBeVisible({ timeout: 10000 });
    
    // Wait for loading spinner to disappear if present
    const loadingText = this.page.locator('text=/Loading settings/i');
    const isLoading = await loadingText.isVisible().catch(() => false);
    if (isLoading) {
      await loadingText.waitFor({ state: 'hidden', timeout: 10000 });
    }
  }

  /**
   * Assert that environment variables section is visible
   */
  async assertEnvironmentVariablesSection(): Promise<void> {
    await expect(this.page.locator(selectors.stakgraph.environmentVariablesHeading)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert that a specific environment variable exists by name
   */
  async assertEnvironmentVariable(name: string): Promise<void> {
    // Find all environment variable name inputs
    const nameInputs = this.page.locator(selectors.stakgraph.environmentVariableName);
    
    // Check if any of them contain the expected name
    const count = await nameInputs.count();
    let found = false;
    
    for (let i = 0; i < count; i++) {
      const value = await nameInputs.nth(i).inputValue();
      if (value === name) {
        found = true;
        break;
      }
    }
    
    expect(found).toBe(true);
  }

  /**
   * Get all environment variable names
   */
  async getEnvironmentVariableNames(): Promise<string[]> {
    const nameInputs = this.page.locator(selectors.stakgraph.environmentVariableName);
    const count = await nameInputs.count();
    const names: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const value = await nameInputs.nth(i).inputValue();
      if (value) {
        names.push(value);
      }
    }
    
    return names;
  }

  /**
   * Add a new environment variable
   */
  async addEnvironmentVariable(name: string, value: string): Promise<void> {
    // Find the first empty name input
    const nameInputs = this.page.locator(selectors.stakgraph.environmentVariableName);
    const count = await nameInputs.count();
    
    for (let i = 0; i < count; i++) {
      const currentValue = await nameInputs.nth(i).inputValue();
      if (!currentValue) {
        await nameInputs.nth(i).fill(name);
        
        // Find the corresponding value input
        const valueInputs = this.page.locator(selectors.stakgraph.environmentVariableValue);
        await valueInputs.nth(i).fill(value);
        break;
      }
    }
  }

  /**
   * Save stakgraph configuration
   */
  async save(): Promise<void> {
    await this.page.locator(selectors.stakgraph.saveButton).click();
    
    // Wait for success message
    await expect(this.page.locator('text=/Configuration saved successfully/i')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if stakgraph page is loaded
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.stakgraph.pageTitle).isVisible();
  }
}
