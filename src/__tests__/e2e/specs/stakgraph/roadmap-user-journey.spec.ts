/**
 * E2E Test: Roadmap User Journey
 * 
 * Tests the complete flow of creating a feature, adding user stories and phases,
 * and creating tickets within phases.
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { expect } from '@playwright/test';
import { 
  AuthPage, 
  DashboardPage, 
  RoadmapPage, 
  FeatureDetailPage, 
  PhaseDetailPage 
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';

test.describe('Roadmap User Journey', () => {
  test('should create feature, user story, phase, and tickets', async ({ page }) => {
    // Setup: Create workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Initialize page objects
    const dashboardPage = new DashboardPage(page);
    const roadmapPage = new RoadmapPage(page);
    const featureDetailPage = new FeatureDetailPage(page);
    const phaseDetailPage = new PhaseDetailPage(page);

    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);

    // Navigate to roadmap
    await dashboardPage.navigateToRoadmap();
    await roadmapPage.waitForLoad();

    // Create a new feature
    const featureTitle = 'Fake feature A';
    const featureId = await roadmapPage.createFeature(featureTitle);
    expect(featureId).toBeTruthy();

    // Wait for feature detail page to load
    await featureDetailPage.waitForLoad();

    // Fill out feature brief
    await featureDetailPage.fillBrief('Fake Brief');

    // Fill out feature requirements
    await featureDetailPage.fillRequirements('Fake Requirements');

    // Fill out feature architecture
    await featureDetailPage.fillArchitecture('Fake Architecture');

    // Add a user story
    const userStoryTitle = 'Fake User Story A';
    await featureDetailPage.addUserStory(userStoryTitle);
    await featureDetailPage.verifyUserStoryExists(userStoryTitle);

    // Add a phase
    const phaseName = 'Phase 1';
    await featureDetailPage.addPhase(phaseName);
    await featureDetailPage.verifyPhaseExists(phaseName);

    // Navigate to phase detail page
    await featureDetailPage.clickPhase(phaseName);
    await phaseDetailPage.waitForLoad();

    // Add first ticket
    const ticket1Title = 'Fake Ticket A';
    await phaseDetailPage.createTicket(ticket1Title);
    await phaseDetailPage.verifyTicketExists(ticket1Title);

    // Add second ticket
    const ticket2Title = 'Fake Ticket B';
    await phaseDetailPage.createTicket(ticket2Title);
    await phaseDetailPage.verifyTicketExists(ticket2Title);

    // Verify both tickets are visible
    await expect(page.locator(`text=${ticket1Title}`)).toBeVisible();
    await expect(page.locator(`text=${ticket2Title}`)).toBeVisible();
  });
});
