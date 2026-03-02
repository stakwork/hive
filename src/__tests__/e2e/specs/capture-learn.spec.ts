import { test, expect } from '@playwright/test';
import { AuthPage } from '../support/page-objects/AuthPage';

test('Capture /learn documentation viewer UI', async ({ page }) => {
  const authPage = new AuthPage(page);
  
  // Sign in with mock
  await authPage.signInWithMock();
  
  // Get the workspace slug
  const workspaceSlug = authPage.getCurrentWorkspaceSlug();
  console.log('Workspace slug:', workspaceSlug);
  
  // Navigate to learn page
  await page.goto(`http://localhost:3000/w/${workspaceSlug}/learn`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  
  // Take full page screenshot
  const screenshotPath = '/tmp/learn-page-capture.png';
  await page.screenshot({ 
    path: screenshotPath,
    fullPage: true 
  });
  
  console.log('Screenshot captured to:', screenshotPath);
});
