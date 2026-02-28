import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Context Learn page (Documentation Viewer)
 * Updated to match new documentation viewer UI (no chat interface)
 */
export class ContextLearnPage {
  constructor(private page: Page) {}

  /**
   * Navigate to Context Learn page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/learn`);
    await this.waitForLoad();
  }

  /**
   * Wait for Context Learn page to fully load
   */
  async waitForLoad(): Promise<void> {
    // Wait for either docs or concepts section to be visible as indicator of page load
    await expect(
      this.page.locator(selectors.learn.docsSection).or(this.page.locator(selectors.learn.conceptsSection))
    ).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Context Learn page via sidebar navigation
   */
  async navigateViaNavigation(): Promise<void> {
    // First expand the Context section if not already expanded
    const contextButton = this.page.locator(selectors.navigation.contextButton);
    const learnLink = this.page.locator(selectors.navigation.learnLink).first();

    // Check if learn link is visible, if not, click Context to expand
    const isLearnVisible = await learnLink.isVisible().catch(() => false);
    if (!isLearnVisible) {
      await contextButton.click();
      await learnLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    // Ensure page is fully loaded and network is idle before navigation
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // If networkidle times out, fall back to domcontentloaded
      return this.page.waitForLoadState('domcontentloaded');
    });
    
    // Wait for the link to be attached and stable
    await learnLink.waitFor({ state: 'attached', timeout: 5000 });
    
    // Small delay to ensure link is fully interactive (reduces race conditions)
    await this.page.waitForTimeout(100);
    
    // Wait for navigation to complete after clicking (using Promise.all for coordination)
    await Promise.all([
      this.page.waitForURL(/\/w\/.*\/learn/, { timeout: 30000 }),
      learnLink.click()
    ]);
    
    await this.waitForLoad();
  }

  /**
   * Check if the docs section is visible
   */
  async isDocsSectionVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.docsSection).isVisible();
  }

  /**
   * Check if the concepts section is visible
   */
  async isConceptsSectionVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.conceptsSection).isVisible();
  }

  /**
   * Check if the content area is visible
   */
  async isContentAreaVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.contentArea).isVisible();
  }

  /**
   * Click on a doc item in the sidebar
   */
  async clickDocItem(index: number = 0): Promise<void> {
    await this.page.locator(selectors.learn.docItem).nth(index).click();
  }

  /**
   * Click on a concept item in the sidebar
   */
  async clickConceptItem(index: number = 0): Promise<void> {
    await this.page.locator(selectors.learn.conceptItem).nth(index).click();
  }

  /**
   * Check if the edit button is visible
   */
  async isEditButtonVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.editButton).isVisible();
  }

  /**
   * Click the edit button to enter edit mode
   */
  async clickEditButton(): Promise<void> {
    await this.page.locator(selectors.learn.editButton).click();
  }

  /**
   * Click the view button to return to view mode
   */
  async clickViewButton(): Promise<void> {
    await this.page.locator(selectors.learn.viewButton).click();
  }

  /**
   * Click the save button
   */
  async clickSaveButton(): Promise<void> {
    await this.page.locator(selectors.learn.saveButton).click();
  }

  /**
   * Check if the save confirmation dialog is visible
   */
  async isSaveConfirmDialogVisible(): Promise<boolean> {
    return await this.page.locator(selectors.learn.saveConfirmDialog).isVisible();
  }

  /**
   * Check if page is loaded (docs or concepts section is visible)
   */
  async isLoaded(): Promise<boolean> {
    const docsVisible = await this.page.locator(selectors.learn.docsSection).isVisible().catch(() => false);
    const conceptsVisible = await this.page.locator(selectors.learn.conceptsSection).isVisible().catch(() => false);
    return docsVisible || conceptsVisible;
  }
}
