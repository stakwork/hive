import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Roadmap page
 * Encapsulates all roadmap interactions and assertions
 */
export class RoadmapPage {
  constructor(private page: Page) {}

  /**
   * Navigate to roadmap for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/roadmap`);
    await this.waitForLoad();
  }

  /**
   * Wait for roadmap page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForURL(/\/w\/.*\/roadmap/, { timeout: 10000 });
    // Wait for the page title to be visible using data-testid
    await waitForElement(this.page, '[data-testid="page-title"]:has-text("Roadmap")', { timeout: 10000 });
  }

  /**
   * Click the "New feature" button to open the create form
   */
  async clickNewFeature(): Promise<void> {
    await this.page.locator(selectors.roadmap.newFeatureButton).click();
    // Wait for the input to appear - this requires the features list to finish loading first
    await waitForElement(this.page, selectors.roadmap.featureInput, { timeout: 20000 });
  }

  /**
   * Create a new feature by typing title and clicking Create button
   */
  async createFeature(title: string): Promise<string> {
    // Click "New feature" button first
    await this.clickNewFeature();
    
    // Type the feature title
    const input = this.page.locator(selectors.roadmap.featureInput);
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(title);
    
    // Click the Create button
    await this.page.locator(selectors.roadmap.createFeatureButton).click();
    
    // Wait for navigation to feature detail page
    await this.page.waitForURL(/\/w\/.*\/roadmap\/.*/, { timeout: 10000 });
    
    // Extract feature ID from URL
    const url = this.page.url();
    const match = url.match(/\/roadmap\/([^/]+)$/);
    if (!match) {
      throw new Error('Failed to extract feature ID from URL');
    }
    
    return match[1];
  }

  /**
   * Verify a feature is visible in the list
   */
  async verifyFeatureExists(featureTitle: string): Promise<void> {
    await waitForElement(this.page, `text=${featureTitle}`, { timeout: 10000 });
  }

  /**
   * Click on a feature to navigate to its detail page
   */
  async clickFeature(featureTitle: string): Promise<void> {
    await this.page.locator(`text=${featureTitle}`).click();
    await this.page.waitForURL(/\/w\/.*\/roadmap\/.*/, { timeout: 10000 });
  }
}
