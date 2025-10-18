/**
 * E2E Test: Stakgraph Configuration User Journey
 * 
 * Tests the user journey for accessing and verifying the Stakgraph configuration
 * section through the settings page.
 */

import { expect } from '@playwright/test';
import { test } from '../../support/fixtures/test-hooks';
import { AuthPage, StakgraphPage, WorkspaceSettingsPage } from '../../support/page-objects';
import { createStandardWorkspaceScenario } from '../../support/fixtures/e2e-scenarios';
import { db } from '@/lib/db';

test.describe('Stakgraph Configuration', () => {
  test('should directly access stakgraph configuration page', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const stakgraphPage = new StakgraphPage(page);

    // Authenticate
    await authPage.signInWithMock();

    // Navigate directly to stakgraph page
    await stakgraphPage.goto(workspace.slug);

    // Verify URL
    await stakgraphPage.verifyUrl(workspace.slug);

    // Assert configuration page is visible
    await stakgraphPage.assertConfigurationVisible();
  });

  test('should display correct page elements on stakgraph configuration', async ({ page }) => {
    // Setup test data
    const scenario = await createStandardWorkspaceScenario();
    const { workspace } = scenario;

    // Initialize page objects
    const authPage = new AuthPage(page);
    const stakgraphPage = new StakgraphPage(page);

    // Authenticate and navigate
    await authPage.signInWithMock();
    await stakgraphPage.goto(workspace.slug);

    // Assert page title
    await stakgraphPage.assertPageTitle('Pool Status');

    // Assert card title
    await stakgraphPage.assertCardTitle('Pool Settings');

    // Assert save button is visible and enabled
    const saveButton = stakgraphPage.getSaveButton();
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });
});
