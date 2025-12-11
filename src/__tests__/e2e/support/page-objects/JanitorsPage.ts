import { Page, expect } from '@playwright/test';
import { selectors, dynamicSelectors } from '../fixtures/selectors';

/**
 * Page Object Model for Janitors page
 * Encapsulates all janitor-related interactions and assertions
 */
export class JanitorsPage {
  constructor(private page: Page) {}

  /**
   * Navigate to janitors page for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/janitors`);
    await this.waitForLoad();
  }

  /**
   * Wait for janitors page to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.janitors.pageTitle)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to janitors page from dashboard using navigation
   */
  async navigateFromDashboard(): Promise<void> {
    // Wait for DOM to be loaded
    await this.page.waitForLoadState('domcontentloaded');
    
    // First expand the Protect section if not already expanded
    const protectButton = this.page.locator(selectors.navigation.protectButton);
    const janitorsLink = this.page.locator(selectors.navigation.janitorsLink).first();

    // Wait for protect button to be visible and clickable
    await expect(protectButton).toBeVisible({ timeout: 15000 });
    
    // Check if janitors link is visible, if not, click Protect to expand
    const isJanitorsVisible = await janitorsLink.isVisible();
    if (!isJanitorsVisible) {
      await protectButton.click();
      // Wait for janitors link to become visible after expansion
      await expect(janitorsLink).toBeVisible({ timeout: 5000 });
    }

    await janitorsLink.click();
    await this.page.waitForURL(/\/w\/.*\/janitors/, { timeout: 10000 });
    await this.waitForLoad();
  }

  /**
   * Verify a janitor section is visible
   */
  async verifyJanitorSectionVisible(sectionName: 'testing' | 'security' | 'maintainability' | 'task-coordinator'): Promise<void> {
    const selectorKey = `section${sectionName.charAt(0).toUpperCase() + sectionName.slice(1).replace(/-([a-z])/g, (g) => g[1].toUpperCase())}` as keyof typeof selectors.janitors;
    const selector = selectors.janitors[selectorKey];
    await expect(this.page.locator(selector)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify a janitor item is visible by its ID
   */
  async verifyJanitorItemVisible(janitorId: string): Promise<void> {
    // Convert janitor ID to the selector key format
    // UNIT_TESTS -> itemUnitTests
    // ticket-sweep -> itemTicketSweep
    const toCamelCase = (str: string) => {
      return str.split(/[-_]/).map((word, index) => 
        index === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() :
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join('');
    };
    
    const itemKey = `item${toCamelCase(janitorId)}` as keyof typeof selectors.janitors;
    const selector = selectors.janitors[itemKey];
    
    if (!selector) {
      // Fallback to dynamic selector if not found in static selectors
      await expect(this.page.locator(`[data-testid="janitor-item-${janitorId}"]`)).toBeVisible({ timeout: 10000 });
    } else {
      await expect(this.page.locator(selector)).toBeVisible({ timeout: 10000 });
    }
  }

  /**
   * Verify a janitor name is displayed
   */
  async verifyJanitorName(janitorId: string, expectedName: string): Promise<void> {
    const selector = dynamicSelectors.janitorName(janitorId);
    await expect(this.page.locator(selector)).toContainText(expectedName, { timeout: 10000 });
  }

  /**
   * Verify a janitor status badge is displayed
   */
  async verifyJanitorStatus(janitorId: string, expectedStatus: string): Promise<void> {
    const selector = dynamicSelectors.janitorStatus(janitorId);
    await expect(this.page.locator(selector)).toContainText(expectedStatus, { timeout: 10000 });
  }

  /**
   * Verify all essential janitors are visible with their statuses
   */
  async verifyEssentialJanitorsVisible(): Promise<void> {
    // Essential janitors to verify - using actual IDs from the page
    const essentialJanitors = [
      { id: 'SECURITY_REVIEW', name: 'Security Review' },
      { id: 'UNIT_TESTS', name: 'Unit Tests' },
      { id: 'INTEGRATION_TESTS', name: 'Integration Tests' },
      { id: 'MOCK_GENERATION', name: 'Mock Generation' },
      { id: 'recommendation-sweep', name: 'Recommendation Sweep' },
      { id: 'ticket-sweep', name: 'Ticket Sweep' },
    ];

    // Verify each janitor is visible
    for (const janitor of essentialJanitors) {
      await this.verifyJanitorItemVisible(janitor.id);
      await this.verifyJanitorName(janitor.id, janitor.name);
      // Verify status badge exists (can be Active, Idle, or Coming Soon)
      const statusSelector = dynamicSelectors.janitorStatus(janitor.id);
      await expect(this.page.locator(statusSelector)).toBeVisible({ timeout: 10000 });
    }
  }

  /**
   * Check if a janitor is in "Active" status
   */
  async isJanitorActive(janitorId: string): Promise<boolean> {
    const selector = dynamicSelectors.janitorStatus(janitorId);
    const statusText = await this.page.locator(selector).textContent();
    return statusText?.includes('Active') || false;
  }

  /**
   * Check if a janitor shows "Coming Soon" status
   */
  async isJanitorComingSoon(janitorId: string): Promise<boolean> {
    const selector = dynamicSelectors.janitorStatus(janitorId);
    const statusText = await this.page.locator(selector).textContent();
    return statusText?.includes('Coming Soon') || false;
  }
}
