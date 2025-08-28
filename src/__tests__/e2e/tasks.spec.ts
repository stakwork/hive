import { test, expect } from "@playwright/test";

test("User interaction replay", async ({ page }) => {
  // Navigate to the page
  await page.goto("http://localhost:3000");

  // Wait for page to load
  await page.waitForLoadState("networkidle");

  // Set viewport size to match recorded session
  await page.setViewportSize({
    width: 1456,
    height: 549,
  });

  // Click on div
  await page.click("div.text-2xl.font-bold");

  await page.waitForTimeout(2090);

  // Click on div
  await page.click("div.text-2xl.font-bold");

  // Assert element contains text: div.grid.auto-rows-min.items-start
  await expect(
    page.locator("div.grid.auto-rows-min.items-start"),
  ).toContainText("Welcome to Hive\n");

  await page.waitForTimeout(2675);

  // Click on button "Signing in..."
  await page.click('[data-testid="mock-signin-button"]');

  await page.waitForTimeout(5000);

  // Click on button "Tasks"
  await page.click('button:has-text("Tasks")');

  // Assert element contains text: h1.text-3xl.font-bold.text-foreground
  await expect(
    page.locator("h1.text-3xl.font-bold.text-foreground"),
  ).toContainText("Tasks");

  await page.waitForTimeout(4876);

  // Click on button "New Task"
  await page.click('button:has-text("New Task")');

  await page.waitForTimeout(5000);

  // Fill input: textarea.border-input.flex.field-sizing-content
  await page.fill("textarea.border-input.flex.field-sizing-content", "hello");

  // Click on button
  await page.click("button.inline-flex.items-center.justify-center");

  await page.waitForTimeout(432);
});
