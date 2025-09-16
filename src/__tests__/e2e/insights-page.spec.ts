import { test, expect } from '@playwright/test';

test.describe('Insights Page', () => {
  test('should navigate to insights page and verify active status', async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:3000');
    
    // Wait for page to load completely
    await page.waitForLoadState('networkidle');
    
    // Set viewport size to match recorded session
    await page.setViewportSize({ 
      width: 1028, 
      height: 549 
    });
  
    // Login process
    const usernameInput = page.locator('#mock-username');
    await usernameInput.waitFor({ state: 'visible' });
    await usernameInput.fill('ddd_test');
    
    const signInButton = page.locator('[data-testid="mock-signin-button"]');
    await signInButton.waitFor({ state: 'visible' });
    await signInButton.click();
    
    // Wait for login to complete by looking for elements that would be present after login
    // This is more reliable than a fixed timeout
    const workspaceNavigation = page.locator('nav:has(button:has-text("Insights"))');
    await workspaceNavigation.waitFor({ state: 'visible', timeout: 10000 });
    
    // Navigate to Insights page
    const insightsButton = page.locator('button:has-text("Insights")');
    await insightsButton.click();
    
    // Verify we're on the Insights page by checking the heading
    const insightsHeading = page.locator('h1.text-3xl.font-bold.text-foreground');
    await expect(insightsHeading).toBeVisible();
    await expect(insightsHeading).toContainText('Insights');
    
    // Find and interact with the toggle button 
    // Using a more specific selector to avoid ambiguity
    const toggleButton = page.locator('button.peer.inline-flex.w-8').first();
    await toggleButton.waitFor({ state: 'visible' });
    await toggleButton.click();
    
    // Verify active status is displayed
    // Adding more specificity to the selector to avoid potential conflicts
    const statusBadge = page.locator('span.inline-flex.items-center.justify-center:has-text("Active")');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText('Active');
    
    // Take a screenshot of the final state for verification purposes
    await page.screenshot({ path: 'test-results/insights-page-test.png' });
  });
});