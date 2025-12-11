/**
 * E2E Test: Global Search using Quick Search
 *
 * Tests the global search functionality accessible via Cmd+K/Ctrl+K keyboard shortcut.
 * Verifies users can quickly find and navigate to features, tasks, and other content.
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import {
  AuthPage,
  DashboardPage,
  GlobalSearchPage,
} from '@/__tests__/e2e/support/page-objects';
import { createWorkspaceWithSearchableContentScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { assertURLPattern } from '@/__tests__/e2e/support/helpers/assertions';

test.describe('Global Search using Quick Search', () => {
  test('should search and navigate to a feature via global search', async ({ page }) => {
    // Setup: Create workspace with searchable content
    const scenario = await createWorkspaceWithSearchableContentScenario();
    const { workspace, feature } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const globalSearchPage = new GlobalSearchPage(page);

    // Sign in with mock provider
    await authPage.goto();
    await authPage.signInWithMock();

    // Navigate to workspace dashboard
    await dashboardPage.goto(workspace.slug);

    // Open global search using keyboard shortcut
    await globalSearchPage.open();
    await expect(page).toHaveURL(/.*\/w\/.*/);

    // Verify search dialog is open
    const isOpen = await globalSearchPage.isOpen();
    expect(isOpen).toBe(true);

    // Enter search query for "api"
    await globalSearchPage.search('api');

    // Wait for and verify search results appear
    await globalSearchPage.assertResultsVisible();

    // Verify the feature appears in search results
    await globalSearchPage.assertResultInList('API Integration');

    // Select the feature from search results and wait for navigation
    const navigationPromise = page.waitForURL(/\/w\/.*\/plan\/.*/, { timeout: 10000 });
    await globalSearchPage.selectResultByTitle('API Integration');
    await navigationPromise;

    // Verify navigation to the feature detail page
    await assertURLPattern(page, /\/w\/.*\/plan\/.*/);

    // Verify the URL contains the feature ID
    expect(page.url()).toContain(feature.id);
  });

  test('should search for tasks and navigate to task detail', async ({ page }) => {
    // Setup: Create workspace with searchable content
    const scenario = await createWorkspaceWithSearchableContentScenario();
    const { workspace, tasks } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const globalSearchPage = new GlobalSearchPage(page);

    // Sign in and navigate to workspace
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.goto(workspace.slug);

    // Open global search
    await globalSearchPage.open();

    // Search for tasks containing "authentication"
    await globalSearchPage.search('authentication');

    // Verify results appear
    await globalSearchPage.assertResultsVisible();

    // Verify the task appears in results
    await globalSearchPage.assertResultInList('Implement API authentication');

    // Select the task from search results and wait for navigation
    const navigationPromise = page.waitForURL(/\/w\/.*\/task\/.*/, { timeout: 10000 });
    await globalSearchPage.selectResultByTitle('Implement API authentication');
    await navigationPromise;

    // Verify we're on the task detail page
    await assertURLPattern(page, /\/w\/.*\/task\/.*/);

    // Verify task content is visible
    await expect(page.getByText('Implement API authentication')).toBeVisible({ timeout: 5000 });
  });

  test('should show empty state when no results found', async ({ page }) => {
    // Setup: Create standard workspace
    const scenario = await createWorkspaceWithSearchableContentScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const globalSearchPage = new GlobalSearchPage(page);

    // Sign in and navigate to workspace
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.goto(workspace.slug);

    // Open global search
    await globalSearchPage.open();

    // Search for something that doesn't exist
    await globalSearchPage.search('xyz123nonexistent');

    // Wait for debounce and search to complete
    await page.waitForTimeout(500);

    // Verify no results message is shown
    await globalSearchPage.assertNoResults();
  });

  test('should close search dialog with Escape key', async ({ page }) => {
    // Setup: Create standard workspace
    const scenario = await createWorkspaceWithSearchableContentScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const globalSearchPage = new GlobalSearchPage(page);

    // Sign in and navigate to workspace
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.goto(workspace.slug);

    // Open global search
    await globalSearchPage.open();

    // Verify dialog is open
    const isOpen = await globalSearchPage.isOpen();
    expect(isOpen).toBe(true);

    // Close with Escape key
    await globalSearchPage.close();

    // Verify dialog is closed
    const isClosed = !(await globalSearchPage.isOpen());
    expect(isClosed).toBe(true);
  });

  test('should handle multiple search results and select correct one', async ({ page }) => {
    // Setup: Create workspace with multiple searchable items
    const scenario = await createWorkspaceWithSearchableContentScenario();
    const { workspace, tasks } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const globalSearchPage = new GlobalSearchPage(page);

    // Sign in and navigate to workspace
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.goto(workspace.slug);

    // Open global search
    await globalSearchPage.open();

    // Search for "api" which should return multiple results (feature + task)
    await globalSearchPage.search('api');

    // Wait for results
    await globalSearchPage.assertResultsVisible();

    // Get result count
    const resultCount = await globalSearchPage.getResultCount();
    expect(resultCount).toBeGreaterThan(1);

    // Get all result titles to verify multiple results
    const titles = await globalSearchPage.getResultTitles();
    expect(titles.length).toBeGreaterThan(1);

    // Verify both expected results are present
    expect(titles).toContain('API Integration');
    expect(titles).toContain('Implement API authentication');
  });
});
