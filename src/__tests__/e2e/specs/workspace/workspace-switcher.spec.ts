import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { AuthPage, DashboardPage } from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';

test.describe('Workspace Switcher', () => {
  test('should display workspace count in switcher dropdown', async ({ page }) => {
    // Arrange - Create test workspace and sign in
    const scenario = await createStandardWorkspaceScenario();
    const authPage = new AuthPage(page);
    await authPage.signInWithMock();

    // Navigate to workspace dashboard
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto(scenario.workspace.slug);

    // Act - Open the workspace switcher dropdown
    await dashboardPage.openWorkspaceSwitcher();

    // Assert - Verify the workspace count label is displayed correctly
    await dashboardPage.verifyWorkspaceSwitcherLabel('Workspaces (1)');
  });
});
