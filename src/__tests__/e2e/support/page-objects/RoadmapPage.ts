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
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/plan`);
    await this.waitForLoad();
  }

  /**
   * Wait for roadmap page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForURL(/\/w\/.*\/plan/, { timeout: 10000 });
    // Wait for the page title to be visible using data-testid
    await waitForElement(this.page, '[data-testid="page-title"]:has-text("Plan")', { timeout: 10000 });
  }

  /**
   * Create a new feature by typing title and pressing Enter
   */
  async createFeature(title: string): Promise<string> {
    // Type the feature title - the component auto-creates when input is filled
    const input = this.page.locator('input.border-input.flex.h-9').first();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(title);
    await input.press('Enter');
    
    // Wait for navigation to feature detail page
    await this.page.waitForURL(/\/w\/.*\/plan\/.*/, { timeout: 10000 });
    
    // Extract feature ID from URL
    const url = this.page.url();
    const match = url.match(/\/plan\/([^/]+)$/);
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
    await this.page.waitForURL(/\/w\/.*\/plan\/.*/, { timeout: 10000 });
  }
}
