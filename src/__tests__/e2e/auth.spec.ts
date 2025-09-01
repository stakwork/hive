import { test, expect } from "@playwright/test";

test("user can log in", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.click('[data-testid="mock-signin-button"]');
  await page.waitForTimeout(400);
  await expect(page).toHaveURL("http://localhost:3000/w/mock-stakgraph");
  await expect(
    page.locator("text=Welcome to your development workspace."),
  ).toBeVisible();
  await page.waitForTimeout(400);
});
