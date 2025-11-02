import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import {
  AuthPage,
  DashboardPage,
  CallsPage,
  LearnPage,
  UserJourneysPage,
  InsightsPage,
  RoadmapPage,
  TasksPage,
} from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';

/**
 * Workspace navigation user journey tests
 * Tests complete navigation flow through all workspace pages
 */
test.describe('Workspace Navigation User Journey', () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let callsPage: CallsPage;
  let learnPage: LearnPage;
  let userJourneysPage: UserJourneysPage;
  let insightsPage: InsightsPage;
  let roadmapPage: RoadmapPage;
  let tasksPage: TasksPage;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    workspaceSlug = scenario.workspace.slug;

    // Initialize page objects
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    callsPage = new CallsPage(page);
    learnPage = new LearnPage(page);
    userJourneysPage = new UserJourneysPage(page);
    insightsPage = new InsightsPage(page);
    roadmapPage = new RoadmapPage(page);
    tasksPage = new TasksPage(page);

    // Authenticate and navigate to dashboard
    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
  });

  test('should navigate through all workspace pages in sequence', async ({ page }) => {
    // Verify starting on graph/dashboard
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();

    // Navigate to Calls page
    await callsPage.navigateViaNavigation();
    await expect(page.locator(selectors.pageTitle.calls)).toBeVisible();
    await expect(page.locator(selectors.pageTitle.element)).toContainText('Calls');

    // Navigate to Learn page
    await learnPage.navigateViaNavigation();
    await expect(page.locator('h1:has-text("Learning Assistant")')).toBeVisible();

    // Navigate to User Journeys page
    await userJourneysPage.navigateViaNavigation();
    await expect(page.locator('h1:has-text("User Journeys")')).toBeVisible();

    // Navigate to Insights page
    await insightsPage.navigateViaNavigation();
    await expect(page.locator(selectors.pageTitle.insights)).toBeVisible();
    await expect(page.locator(selectors.pageTitle.element)).toContainText('Insights');

    // Navigate to Roadmap page
    await roadmapPage.navigateViaNavigation();
    await expect(page.locator(selectors.pageTitle.roadmap)).toBeVisible();
    await expect(page.locator(selectors.pageTitle.element)).toContainText('Roadmap');

    // Navigate to Tasks page
    await tasksPage.navigateViaNavigation();
    await expect(page.locator(selectors.pageTitle.tasks)).toBeVisible();
    await expect(page.locator(selectors.pageTitle.element)).toContainText('Tasks');

    // Navigate back to Graph/Dashboard
    await page.locator(selectors.navigation.graphLink).click();
    await page.waitForURL(new RegExp(`/w/${workspaceSlug}$`), { timeout: 10000 });
    await expect(page.locator('[data-testid="graph-component"]')).toBeVisible();
  });

  test('should maintain workspace context across navigation', async ({ page }) => {
    // Navigate through multiple pages
    await callsPage.navigateViaNavigation();
    expect(page.url()).toContain(`/w/${workspaceSlug}/calls`);

    await tasksPage.navigateViaNavigation();
    expect(page.url()).toContain(`/w/${workspaceSlug}/tasks`);

    await insightsPage.navigateViaNavigation();
    expect(page.url()).toContain(`/w/${workspaceSlug}/insights`);

    // Verify workspace slug is preserved in all URLs
    const urlPattern = new RegExp(`/w/${workspaceSlug}/`);
    expect(page.url()).toMatch(urlPattern);
  });
});
