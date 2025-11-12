/**
 * E2E Test: Environment Variables in Stakgraph
 * 
 * Tests the user journey of viewing environment variables
 * in the stakgraph configuration page.
 */

import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';
import { 
  AuthPage, 
  DashboardPage, 
  StakgraphPage 
} from '@/__tests__/e2e/support/page-objects';
import { createStandardWorkspaceScenario } from '@/__tests__/e2e/support/fixtures/e2e-scenarios';
import { db } from '@/lib/db';

test.describe('Environment Variables in Stakgraph', () => {
  test('should view environment variables in stakgraph configuration', async ({ page }) => {
    // Setup: Create workspace with environment variables
    const scenario = await createStandardWorkspaceScenario();
    
    // Add environment variables to the swarm
    if (scenario.swarm) {
      await db.swarm.update({
        where: { id: scenario.swarm.id },
        data: {
          environmentVariables: [
            { name: 'NODE_ENV', value: 'production' },
            { name: 'API_URL', value: 'https://api.example.com' },
          ],
        },
      });
    }
    
    // Initialize page objects
    const authPage = new AuthPage(page);
    const dashboardPage = new DashboardPage(page);
    const stakgraphPage = new StakgraphPage(page);
    
    // Sign in with mock authentication
    await authPage.signInWithMock();
    
    // Navigate to workspace dashboard
    await dashboardPage.goto(scenario.workspace.slug);
    
    // Navigate directly to stakgraph
    await stakgraphPage.goto(scenario.workspace.slug);
    
    // Assert environment variables section is visible
    await stakgraphPage.assertEnvironmentVariablesSection();
    
    // Assert NODE_ENV environment variable exists
    await stakgraphPage.assertEnvironmentVariable('NODE_ENV');
    
    // Assert API_URL environment variable exists
    await stakgraphPage.assertEnvironmentVariable('API_URL');
  });
});
