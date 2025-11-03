import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Stakgraph Configuration page
 * Encapsulates all stakgraph/pool configuration interactions
 */
export class StakgraphPage {
  constructor(private page: Page) {}

  /**
   * Navigate to stakgraph configuration page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/stakgraph`);
    await this.waitForLoad();
  }

  /**
   * Wait for stakgraph page to fully load
   */
  async waitForLoad(): Promise<void> {
    // Wait for the pool settings title to be visible
    await expect(this.page.locator(selectors.stakgraph.poolSettingsTitle)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate back to settings page
   */
  async goBackToSettings(): Promise<void> {
    await this.page.locator(selectors.stakgraph.backToSettingsButton).click();
    await this.page.waitForURL(/\/w\/.*\/settings/, { timeout: 10000 });
  }

  /**
   * Click the save button to save configuration
   */
  async saveConfiguration(): Promise<void> {
    await this.page.locator(selectors.stakgraph.saveButton).click();
    // Wait for success message or loading to complete
    await expect(this.page.locator('text=/Configuration saved successfully/i')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Click add webhooks button
   */
  async addGithubWebhooks(): Promise<void> {
    const webhookButton = this.page.locator(selectors.stakgraph.addWebhooksButton);
    await expect(webhookButton).toBeVisible({ timeout: 5000 });
    await webhookButton.click();
  }

  /**
   * Verify page is loaded (pool settings title is visible)
   */
  async isLoaded(): Promise<boolean> {
    return await this.page.locator(selectors.stakgraph.poolSettingsTitle).isVisible();
  }

  /**
   * Fill project name
   */
  async fillProjectName(name: string): Promise<void> {
    const nameInput = this.page.locator('input[name="name"]').first();
    await nameInput.clear();
    await nameInput.fill(name);
  }

  /**
   * Fill repository URL
   */
  async fillRepositoryUrl(url: string): Promise<void> {
    const urlInput = this.page.locator('input[placeholder*="repository" i]').first();
    await urlInput.clear();
    await urlInput.fill(url);
  }

  /**
   * Verify configuration saved message is visible
   */
  async verifyConfigurationSaved(): Promise<void> {
    await expect(this.page.locator('text=/Configuration saved successfully/i')).toBeVisible({ timeout: 10000 });
  }
}
