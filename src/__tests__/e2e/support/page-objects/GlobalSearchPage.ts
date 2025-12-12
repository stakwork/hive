import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';
import { waitForElement } from '../helpers/waits';

/**
 * Page Object Model for Global Search functionality
 * Encapsulates all global/quick search interactions
 */
export class GlobalSearchPage {
  constructor(private page: Page) {}

  /**
   * Open the global search dialog using keyboard shortcut
   */
  async open(): Promise<void> {
    // Use Cmd+K on Mac, Ctrl+K on other platforms
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    
    await this.page.keyboard.press(`${modifier}+KeyK`);
    await this.waitForSearchDialog();
  }

  /**
   * Wait for search dialog to be visible
   */
  async waitForSearchDialog(): Promise<void> {
    await waitForElement(this.page, selectors.globalSearch.input);
  }

  /**
   * Check if search dialog is open
   */
  async isOpen(): Promise<boolean> {
    return await this.page.locator(selectors.globalSearch.input).isVisible();
  }

  /**
   * Enter a search query
   */
  async search(query: string): Promise<void> {
    const searchInput = this.page.locator(selectors.globalSearch.input);
    await searchInput.fill(query);
  }

  /**
   * Wait for search results to appear
   */
  async waitForResults(): Promise<void> {
    // Wait for at least one result item to be visible
    await this.page.locator(selectors.globalSearch.resultItem).first().waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Get the number of search results
   */
  async getResultCount(): Promise<number> {
    // Wait a bit for debounced search to complete
    await this.page.waitForTimeout(500);
    
    const results = this.page.locator(selectors.globalSearch.resultItem);
    return await results.count();
  }

  /**
   * Select a result by its title (visible text)
   */
  async selectResultByTitle(title: string): Promise<void> {
    // Find the result item that contains the title and wait for it specifically
    const resultItem = this.page.locator(selectors.globalSearch.resultItem)
      .filter({ hasText: title });

    // Wait for this specific result to be visible
    await resultItem.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for cmdk to fully process the search results
    await this.page.waitForTimeout(100);

    // Get all result items to find the index of our target
    const allResults = this.page.locator(selectors.globalSearch.resultItem);
    const count = await allResults.count();

    // Find the index of our target item
    let targetIndex = -1;
    for (let i = 0; i < count; i++) {
      const text = await allResults.nth(i).textContent();
      if (text && text.includes(title)) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      throw new Error(`Could not find result with title: ${title}`);
    }

    // Use keyboard navigation: press Down arrow to reach the item, then Enter to select
    // cmdk auto-highlights the first item, so we need (targetIndex) down presses
    for (let i = 0; i < targetIndex; i++) {
      await this.page.keyboard.press('ArrowDown');
    }

    // Press Enter to select the highlighted item
    await this.page.keyboard.press('Enter');
  }

  /**
   * Select a result by index (0-based)
   */
  async selectResultByIndex(index: number): Promise<void> {
    await this.waitForResults();

    // Wait for cmdk to fully process the search results
    await this.page.waitForTimeout(100);

    // Use keyboard navigation: press Down arrow to reach the item, then Enter to select
    // cmdk auto-highlights the first item, so we need (index) down presses
    for (let i = 0; i < index; i++) {
      await this.page.keyboard.press('ArrowDown');
    }

    // Press Enter to select the highlighted item
    await this.page.keyboard.press('Enter');
  }

  /**
   * Assert search results are visible
   */
  async assertResultsVisible(): Promise<void> {
    await expect(this.page.locator(selectors.globalSearch.resultItem).first())
      .toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert specific result is in the list by title
   */
  async assertResultInList(title: string): Promise<void> {
    await this.waitForResults();
    
    const resultWithTitle = this.page.locator(selectors.globalSearch.resultTitle)
      .filter({ hasText: title });
    
    await expect(resultWithTitle).toBeVisible();
  }

  /**
   * Get all result titles
   */
  async getResultTitles(): Promise<string[]> {
    await this.waitForResults();
    
    const titleElements = this.page.locator(selectors.globalSearch.resultTitle);
    const count = await titleElements.count();
    
    const titles: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await titleElements.nth(i).textContent();
      if (text) titles.push(text);
    }
    
    return titles;
  }

  /**
   * Assert no results message is shown
   */
  async assertNoResults(): Promise<void> {
    await expect(this.page.getByText(/No results found/i)).toBeVisible();
  }

  /**
   * Close the search dialog
   */
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    
    // Wait for dialog to close
    await expect(this.page.locator(selectors.globalSearch.input))
      .not.toBeVisible();
  }
}
