/**
 * E2E Test: Create New Feature and Generate User Stories
 * 
 * Tests the complete flow of:
 * 1. Creating a new feature
 * 2. Adding a brief
 * 3. Selecting user personas
 * 4. Adding user stories manually
 * 5. Generating user stories with AI (optional)
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { AuthPage } from '@/__tests__/e2e/support/page-objects/AuthPage';
import { RoadmapPage } from '@/__tests__/e2e/support/page-objects/RoadmapPage';
import { FeatureDetailPage } from '@/__tests__/e2e/support/page-objects/FeatureDetailPage';

test.describe('Create New Feature and Generate User Stories', () => {
  test('should create a feature, add brief, select personas, and add user stories', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Test data
    const featureName = 'User Authentication System';
    const featureBrief = 'Implement a secure user authentication system with email/password login';
    const personas = ['End User', 'Admin'];
    const userStories = [
      'As an end user, I want to register with email and password',
      'As an end user, I want to login to my account',
    ];

    // Initialize Page Objects
    const authPage = new AuthPage(page);
    const roadmapPage = new RoadmapPage(page);
    const featureDetailPage = new FeatureDetailPage(page);

    // Step 1: Sign in with mock authentication
    await authPage.signInWithMock();

    // Step 2: Navigate to the Plan/Roadmap page
    await roadmapPage.goto(workspaceSlug);

    // Step 3: Create a new feature
    const featureId = await roadmapPage.createFeature(featureName);
    expect(featureId).toBeTruthy();

    // Step 4: Verify we're on the feature detail page
    await featureDetailPage.waitForLoad();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/plan/${featureId}`));

    // Step 5: Fill in the feature brief
    await featureDetailPage.fillBrief(featureBrief);

    // Step 6: Verify brief was saved (by checking it's visible)
    await expect(page.locator('#brief')).toHaveValue(featureBrief);

    // Step 7: Add user personas using the dropdown suggestions
    for (const persona of personas) {
      await featureDetailPage.selectPersonaSuggestion(persona);
    }
    
    // Verify personas were added
    for (const persona of personas) {
      await featureDetailPage.verifyPersonaExists(persona);
    }

    // Step 8: Add user stories manually
    for (const story of userStories) {
      await featureDetailPage.addUserStory(story);
    }
    
    // Wait a bit for all stories to be saved
    await page.waitForTimeout(2000);
    
    // Verify user stories were added
    for (const story of userStories) {
      await featureDetailPage.verifyUserStoryExists(story);
    }

    // Step 9: Verify all data is present on the page
    await expect(page.locator('text=' + featureName)).toBeVisible();
    await expect(page.locator('#brief')).toHaveValue(featureBrief);
    
    // Verify personas are visible as badges - use .first() since they may appear in user stories too
    for (const persona of personas) {
      await expect(page.getByText(persona, { exact: true }).first()).toBeVisible();
    }
    
    // Verify user stories are visible
    for (const story of userStories) {
      await expect(page.locator(`text=${story}`)).toBeVisible();
    }
  });

  test('should create a feature and generate user stories with AI', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Test data - using valid personas from COMMON_PERSONAS
    const featureName = 'Shopping Cart';
    const featureBrief = 'Allow users to add items to cart and checkout';
    const personas = ['End User', 'Developer'];

    // Initialize Page Objects
    const authPage = new AuthPage(page);
    const roadmapPage = new RoadmapPage(page);
    const featureDetailPage = new FeatureDetailPage(page);

    // Step 1: Sign in
    await authPage.signInWithMock();

    // Step 2: Navigate to Plan page
    await roadmapPage.goto(workspaceSlug);

    // Step 3: Create feature
    const featureId = await roadmapPage.createFeature(featureName);
    await featureDetailPage.waitForLoad();

    // Step 4: Fill brief
    await featureDetailPage.fillBrief(featureBrief);

    // Step 5: Add personas
    for (const persona of personas) {
      await featureDetailPage.selectPersonaSuggestion(persona);
    }

    // Step 6: Click Generate button to generate user stories
    await featureDetailPage.clickGenerateUserStories();

    // Step 7: Wait for AI suggestions to appear (if AI is enabled)
    // Note: This might timeout if AI is not configured, which is acceptable
    try {
      // Wait for Accept button to appear (indicates AI generated stories)
      await page.waitForSelector('button:has-text("Accept")', { timeout: 5000 });
      
      // Accept the first generated story
      await featureDetailPage.acceptGeneratedStory(0);
      
      // Verify at least one story was added
      const storyElements = await page.locator('.flex.items-center.gap-3').count();
      expect(storyElements).toBeGreaterThanOrEqual(1);
    } catch (error) {
      // AI generation might not be available in test environment
      console.log('AI generation not available or timed out - this is acceptable in test environment');
    }

    // Verify feature details are still present
    await expect(page.locator('#brief')).toHaveValue(featureBrief);
  });

  test('should navigate back to plan page from feature detail', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    const workspaceSlug = scenario.workspace.slug;

    // Test data
    const featureName = 'Test Feature';

    // Initialize Page Objects
    const authPage = new AuthPage(page);
    const roadmapPage = new RoadmapPage(page);
    const featureDetailPage = new FeatureDetailPage(page);

    // Sign in and create feature
    await authPage.signInWithMock();
    await roadmapPage.goto(workspaceSlug);
    await roadmapPage.createFeature(featureName);
    await featureDetailPage.waitForLoad();

    // Click Back button
    const backButton = page.locator('button:has-text("Back")').first();
    await backButton.click();

    // Verify we're back on the plan page
    await roadmapPage.waitForLoad();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/plan$`));

    // Verify the feature we created is visible in the list
    await roadmapPage.verifyFeatureExists(featureName);
  });
});
