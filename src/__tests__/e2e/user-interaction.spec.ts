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

  // Assert element contains text: div.grid.auto-rows-min.items-start
  await expect(
    page.locator("div.grid.auto-rows-min.items-start"),
  ).toContainText("Welcome to Hive\n");

  await page.waitForTimeout(4146);

  // Click on button "Signing in..."
  await page.click('[data-testid="mock-signin-button"]');

  await page.waitForTimeout(432);
});
