import { Page, expect } from '@playwright/test';
import { waitForElement } from '../helpers/waits';
import { selectors } from '../fixtures/selectors';

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
    await this.page.waitForURL(/\/w\/.*\/plan\/.*/, { timeout: 10000 });

    // First, wait for the page to finish loading (no more loading skeletons)
    await this.page.waitForFunction(() => {
      // Check if there are any loading skeletons visible
      const skeletons = document.querySelectorAll('[class*="skeleton"], .animate-pulse');
      return skeletons.length === 0;
    }, { timeout: 15000 });

    // Then wait for the actual form elements to be present
    await this.page.waitForSelector(selectors.feature.briefInput, { state: 'visible', timeout: 30000 });
  }

  /**
   * Fill in the brief field
   */
  async fillBrief(brief: string): Promise<void> {
    const briefInput = this.page.locator(selectors.feature.briefInput);
    await briefInput.waitFor({ state: 'visible', timeout: 10000 });
    await briefInput.click();
    await briefInput.fill(brief);
    // Trigger blur to save
    await this.page.locator('body').click();
    // Small wait for auto-save
    await this.page.waitForTimeout(500);
  }

  /**
   * Add a persona by typing and clicking Add
   */
  async addPersona(personaName: string): Promise<void> {
    const personasInput = this.page.locator(selectors.feature.personasInput);
    await personasInput.waitFor({ state: 'visible', timeout: 10000 });
    await personasInput.click();
    await personasInput.fill(personaName);
    
    // Click the Add button next to the personas input
    const addButton = this.page.locator(selectors.feature.personasAddButton).last();
    await addButton.click();
    
    // Wait for the persona to be added
    await this.page.waitForTimeout(500);
  }

  /**
   * Select persona from suggestions dropdown
   */
  async selectPersonaSuggestion(personaName: string): Promise<void> {
    const personasInput = this.page.locator(selectors.feature.personasInput);
    await personasInput.waitFor({ state: 'visible', timeout: 10000 });
    await personasInput.click();
    
    // Wait for dropdown to appear
    await this.page.waitForTimeout(500);
    
    // Click on the suggestion - use exact match with getByRole
    const suggestion = this.page.getByRole('option', { name: personaName, exact: true });
    await suggestion.waitFor({ state: 'visible', timeout: 5000 });
    await suggestion.click();
    
    // Wait for selection to complete - the component auto-adds on click
    await this.page.waitForTimeout(1500);
  }

  /**
   * Verify persona was added
   */
  async verifyPersonaExists(personaName: string): Promise<void> {
    // Wait a bit for the persona to appear and be saved
    await this.page.waitForTimeout(1000);
    
    // Simply verify the text exists on the page - personas are displayed as badges
    // but checking for exact badge class might be fragile
    await expect(this.page.getByText(personaName, { exact: true })).toBeVisible({ timeout: 10000 });
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
   * Add a user story manually
   */
  async addUserStory(title: string): Promise<void> {
    // The user story input has placeholder "As a user, I want to..."
    // This is more specific than checking all inputs
    const userStoryInput = this.page.locator('input[placeholder*="As a user"]');
    await userStoryInput.waitFor({ state: 'visible', timeout: 10000 });
    
    // Scroll into view if needed
    await userStoryInput.scrollIntoViewIfNeeded();
    
    // Wait a bit for any animations
    await this.page.waitForTimeout(300);
    
    await userStoryInput.click({ force: true });
    await userStoryInput.fill(title);
    
    // Press Enter to add the story
    await userStoryInput.press('Enter');
    
    // Wait for the story to be added
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click Generate button to generate user stories with AI
   */
  async clickGenerateUserStories(): Promise<void> {
    // There might be multiple Generate buttons on the page (requirements, architecture)
    // We want the one in the User Stories section
    const generateButton = this.page.locator(selectors.feature.generateUserStoriesButton).first();
    await generateButton.waitFor({ state: 'visible', timeout: 10000 });
    await generateButton.click();
    
    // Wait for AI generation to start (there might be a loading state)
    await this.page.waitForTimeout(1000);
  }

  /**
   * Accept a generated user story suggestion
   */
  async acceptGeneratedStory(index: number = 0): Promise<void> {
    // AI suggestions have Accept buttons
    const acceptButton = this.page.locator('button:has-text("Accept")').nth(index);
    await acceptButton.waitFor({ state: 'visible', timeout: 15000 });
    await acceptButton.click();
    
    // Wait for the story to be accepted and added
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
