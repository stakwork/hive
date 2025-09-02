import { test, expect } from '@playwright/test';
    
test('User interaction replay', async ({ page }) => {
  // Navigate to the page
  await page.goto('http://localhost:3000');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Set viewport size to match recorded session
  await page.setViewportSize({ 
    width: 1063, 
    height: 549 
  });

  // Click on button "Signing in..."
  await page.click('[data-testid="mock-signin-button"]');

  await page.waitForTimeout(5000);

  // Click on button "Settings"
  await page.click('button:has-text("Settings")');

  await page.waitForTimeout(5000);

  // Click on input "The display name for your workspace"
  await page.click('input[type="text"]');

  await page.waitForTimeout(2681);

  // Fill input: input.border-input.flex.h-9
  await page.fill('input.border-input.flex.h-9', 'Mock Workspace 123');

  // Click on input "lowercase, use hyphens for spaces"
  await page.click('input[type="text"]');

  await page.waitForTimeout(1578);

  // Fill input: input.border-input.flex.h-9
  await page.fill('input.border-input.flex.h-9', 'mock-stakgraph-123');

  // Click on textarea
  await page.click('textarea.border-input.flex.field-sizing-content');

  await page.waitForTimeout(1687);

  // Fill input: textarea.border-input.flex.field-sizing-content
  await page.fill('textarea.border-input.flex.field-sizing-content', 'Development workspace (mock)-123');

  // Click on button "Update Workspace"
  await page.click('button:has-text("Update Workspace")');

  await page.waitForTimeout(432);
});