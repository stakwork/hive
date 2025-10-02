import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

/**
 * Page Object Model for Dashboard page
 * Encapsulates all dashboard interactions and assertions
 */
export class DashboardPage {
  constructor(private page: Page) {}

  /**
   * Navigate to dashboard for a specific workspace
   */
  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}`);
    await this.waitForLoad();
  }

  /**
   * Wait for dashboard to fully load
   */
  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.dashboard)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify we're on the dashboard page
   */
  async verifyOnDashboardPage(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.dashboard)).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(selectors.pageDescription.dashboard)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to tasks page
   */
  async goToTasks(): Promise<void> {
    await this.page.locator(selectors.navigation.tasksLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/tasks/, { timeout: 10000 });
  }

  /**
   * Navigate to insights page
   */
  async goToInsights(): Promise<void> {
    await this.page.locator(selectors.navigation.insightsLink).first().click();
    await this.page.waitForURL(/\/w\/.*\/insights/, { timeout: 10000 });
  }

  /**
   * Navigate to settings page
   */
  async goToSettings(): Promise<void> {
    await this.page.locator(selectors.navigation.settingsButton).click();
    await expect(this.page.locator(selectors.pageTitle.settings)).toBeVisible();
  }

  /**
   * Reload the page
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }

  // ========== Dashboard Cards Grid ==========

  /**
   * Verify dashboard cards grid is visible
   */
  async verifyCardsGridVisible(): Promise<void> {
    await expect(this.page.locator(selectors.dashboard.cardsGrid)).toBeVisible({ timeout: 10000 });
  }

  // ========== VM Config Section ==========

  /**
   * Verify VM config section is visible
   */
  async verifyVMSectionVisible(): Promise<void> {
    await expect(this.page.locator(selectors.dashboard.vmSection)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if pool status is active (VMs display is visible)
   */
  async hasPoolStatus(): Promise<boolean> {
    const poolStatusVms = this.page.locator(selectors.dashboard.poolStatusVms);
    return await poolStatusVms.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if finish setup button is visible
   */
  async hasFinishSetupButton(): Promise<boolean> {
    const button = this.page.locator(selectors.dashboard.finishSetupButton);
    return await button.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Get running VMs count
   */
  async getRunningVmsCount(): Promise<number> {
    const text = await this.page.locator(selectors.dashboard.poolRunningVms).textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get pending VMs count
   */
  async getPendingVmsCount(): Promise<number> {
    const text = await this.page.locator(selectors.dashboard.poolPendingVms).textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get failed VMs count (if visible)
   */
  async getFailedVmsCount(): Promise<number> {
    const failedVms = this.page.locator(selectors.dashboard.poolFailedVms);
    const isVisible = await failedVms.isVisible().catch(() => false);
    if (!isVisible) return 0;
    const text = await failedVms.textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // ========== Repository Card ==========

  /**
   * Verify repository card is visible
   */
  async verifyRepositoryCardVisible(): Promise<void> {
    await expect(this.page.locator(selectors.dashboard.repoSection)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get repository name
   */
  async getRepositoryName(): Promise<string> {
    return await this.page.locator(selectors.dashboard.repositoryName).textContent() || '';
  }

  /**
   * Get repository status
   */
  async getRepositoryStatus(): Promise<string> {
    return await this.page.locator(selectors.dashboard.repositoryStatus).textContent() || '';
  }

  /**
   * Get repository branch
   */
  async getRepositoryBranch(): Promise<string> {
    return await this.page.locator(selectors.dashboard.repositoryBranch).textContent() || '';
  }

  /**
   * Check if Link GitHub button is visible
   */
  async hasLinkGithubButton(): Promise<boolean> {
    const button = this.page.locator(selectors.dashboard.linkGithubButton);
    return await button.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Click Link GitHub button
   */
  async clickLinkGithub(): Promise<void> {
    await this.page.locator(selectors.dashboard.linkGithubButton).click();
  }

  /**
   * Click Rerun Ingest button
   */
  async clickRerunIngest(): Promise<void> {
    await this.page.locator(selectors.dashboard.rerunIngestButton).click();
  }

  // ========== Test Coverage Card ==========

  /**
   * Verify test coverage card is visible
   */
  async verifyCoverageCardVisible(): Promise<void> {
    await expect(this.page.locator(selectors.dashboard.coverageSection)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if coverage stats are visible
   */
  async hasCoverageStats(): Promise<boolean> {
    const stats = this.page.locator(selectors.dashboard.coverageStats);
    return await stats.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if "No coverage data" message is visible
   */
  async hasNoCoverageData(): Promise<boolean> {
    const noData = this.page.locator(selectors.dashboard.coverageNoData);
    return await noData.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Get unit test coverage percentage
   */
  async getUnitCoverage(): Promise<string> {
    return await this.page.locator(selectors.dashboard.coverageUnit).textContent() || '';
  }

  /**
   * Get integration test coverage percentage
   */
  async getIntegrationCoverage(): Promise<string> {
    return await this.page.locator(selectors.dashboard.coverageIntegration).textContent() || '';
  }

  /**
   * Get E2E test coverage percentage
   */
  async getE2ECoverage(): Promise<string> {
    return await this.page.locator(selectors.dashboard.coverageE2E).textContent() || '';
  }

  // ========== Recent Tasks Section ==========

  /**
   * Verify recent tasks section is visible
   */
  async verifyRecentTasksVisible(): Promise<void> {
    await expect(this.page.locator(selectors.dashboard.recentTasksSection)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if recent tasks section exists
   */
  async hasRecentTasks(): Promise<boolean> {
    const section = this.page.locator(selectors.dashboard.recentTasksSection);
    return await section.isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Get count of tasks in recent tasks section
   */
  async getRecentTasksCount(): Promise<number> {
    // Recent tasks section contains task cards
    const recentSection = this.page.locator(selectors.dashboard.recentTasksSection);
    const taskCards = recentSection.locator(selectors.tasks.taskCard);
    return await taskCards.count();
  }
}
