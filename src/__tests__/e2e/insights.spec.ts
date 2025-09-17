import { test, expect } from '@playwright/test';

test('User should be able to navigate to and interact with the Insights page', async ({ page }) => {
  // Navigate to the app
  await page.goto('http://localhost:3000');
  
  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Set viewport size
  await page.setViewportSize({ 
    width: 1028, 
    height: 549 
  });

  // Login flow
  const usernameInput = page.locator('#mock-username');
  await usernameInput.waitFor({ state: 'visible' });
  await usernameInput.fill('www');
  
  const signinButton = page.locator('[data-testid="mock-signin-button"]');
  await signinButton.waitFor({ state: 'visible' });
  await signinButton.click();
  
  // Verify navigation to dashboard by checking for expected content
  const noTasksMessage = page.locator('div.leading-none.font-semibold.flex');
  await expect(noTasksMessage).toContainText('No tasks created yet');
  
  // Navigate to Insights page
  const insightsButton = page.getByRole('button', { name: 'Insights' });
  await insightsButton.click();
  
  // Wait for the Insights page to load and verify "Testing" element is visible
  const testingElement = page.locator('span').filter({ hasText: 'Testing' });
  await expect(testingElement).toBeVisible({ timeout: 5000 });
  
  // Find toggle buttons and interact with them
  const toggleButtons = page.locator('button.peer.inline-flex.w-8');
  
  // Wait for toggle buttons to be available
  await toggleButtons.first().waitFor({ state: 'visible' });
  const count = await toggleButtons.count();
  
  // Click each visible toggle button
  for (let i = 0; i < Math.min(count, 5); i++) {
    const button = toggleButtons.nth(i);
    await expect(button).toBeVisible();
    await button.click();
    
    // Wait for any UI updates after clicking
    // Instead of arbitrary timeouts, wait for the page to be stable
    await page.waitForLoadState('networkidle');
  }
});