import { Page } from '@playwright/test';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Feature Detail page
 * Encapsulates all feature detail interactions
 */
export class FeatureDetailPage {
  constructor(private page: Page) { }

  /**
   * Navigate to feature detail page
   */
  async goto(workspaceSlug: string, featureId: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/plan/${featureId}`);
    await this.waitForLoad();
  }

  /**
   * Wait for feature detail page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForURL(/\/w\/.*\/roadmap\/.*/, { timeout: 10000 });

    // First, wait for the page to finish loading (no more loading skeletons)
    await this.page.waitForFunction(() => {
      // Check if there are any loading skeletons visible
      const skeletons = document.querySelectorAll('[class*="skeleton"], .animate-pulse');
      return skeletons.length === 0;
    }, { timeout: 15000 });

    // Then wait for the actual form elements to be present
    await this.page.waitForSelector('#brief', { state: 'visible', timeout: 30000 });
  }

  /**
   * Fill in the brief field
   */
  async fillBrief(brief: string): Promise<void> {
    const briefInput = this.page.locator('#brief');
    await briefInput.waitFor({ state: 'visible', timeout: 10000 });
    await briefInput.click();
    await briefInput.fill(brief);
    // Trigger blur to save
    await this.page.locator('body').click();
    // Small wait for auto-save
    await this.page.waitForTimeout(500);
  }

  /**
   * Fill in the requirements field
   */
  async fillRequirements(requirements: string): Promise<void> {
    const reqInput = this.page.locator('#requirements');
    await reqInput.waitFor({ state: 'visible', timeout: 10000 });
    await reqInput.click();
    await reqInput.fill(requirements);
    // Trigger blur to save
    await this.page.locator('body').click();
    // Small wait for auto-save
    await this.page.waitForTimeout(500);
  }

  /**
   * Fill in the architecture field
   */
  async fillArchitecture(architecture: string): Promise<void> {
    const archInput = this.page.locator('#architecture');
    await archInput.waitFor({ state: 'visible', timeout: 10000 });
    await archInput.click();
    await archInput.fill(architecture);
    // Trigger blur to save
    await this.page.locator('body').click();
    // Small wait for auto-save
    await this.page.waitForTimeout(500);
  }

  /**
   * Add a user story
   */
  async addUserStory(title: string): Promise<void> {
    // Find the user story input field - need to locate within user stories section
    const userStoryInput = this.page.locator('input.border-input.flex.h-9').nth(1);
    await userStoryInput.waitFor({ state: 'visible', timeout: 10000 });
    await userStoryInput.fill(title);
    await userStoryInput.press('Enter');
    // Wait for the story to be added
    await this.page.waitForTimeout(1000);
  }

  /**
   * Add a phase
   */
  async addPhase(phaseName: string): Promise<void> {
    // Find the phase input - typically further down in the form
    const phaseInput = this.page.locator('input.border-input.flex.h-9').last();
    await phaseInput.waitFor({ state: 'visible', timeout: 10000 });
    await phaseInput.fill(phaseName);
    await phaseInput.press('Enter');
    // Wait for phase to be created
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click on a phase to navigate to its detail page
   */
  async clickPhase(phaseName: string): Promise<void> {
    // Find phase by its name text
    const phaseLink = this.page.locator(`text=${phaseName}`).last();
    await phaseLink.waitFor({ state: 'visible', timeout: 10000 });
    await phaseLink.click();
    // Wait for navigation to phase detail page
    await this.page.waitForURL(/\/w\/.*\/phases\/.*/, { timeout: 10000 });
  }

  /**
   * Verify user story exists
   */
  async verifyUserStoryExists(title: string): Promise<void> {
    await waitForElement(this.page, `text=${title}`, { timeout: 10000 });
  }

  /**
   * Verify phase exists
   */
  async verifyPhaseExists(phaseName: string): Promise<void> {
    await waitForElement(this.page, `text=${phaseName}`, { timeout: 10000 });
  }
}
