/**
 * E2E Test: Mock Sign In - Workspace Switcher Label
 * 
 * Tests that after mock sign in, the workspace switcher displays "Workspaces" label
 * when opened.
 */

import { test, expect } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage } from '@/__tests__/e2e/support/page-objects/AuthPage';
import { DashboardPage } from '@/__tests__/e2e/support/page-objects/DashboardPage';
import { selectors } from '@/__tests__/e2e/support/fixtures/selectors';
import { assertContainsText } from '@/__tests__/e2e/support/helpers/assertions';
import { createMockStakgraphWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Mock Sign In - Workspace Switcher', () => {
  test('should display "Workspaces" label in workspace switcher after sign in', async ({ page }) => {
    // Setup: Create workspace with specific slug
    await createMockStakgraphWorkspaceScenario();

    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: Sign in with mock auth
    await authPage.signInWithMock();

    // Step 2: Navigate to the specific workspace
    await dashboardPage.goto('mock-stakgraph');

    // Step 3: Open workspace switcher dropdown
    await dashboardPage.openWorkspaceSwitcher();

    // Step 4: Assert the workspace switcher label contains "Workspaces"
    await assertContainsText(page, selectors.workspace.switcherLabel, 'Workspaces');
  });
});
