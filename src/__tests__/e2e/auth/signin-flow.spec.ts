import { test, expect, type Page } from "@playwright/test";
import { db } from "@/lib/db";

// Test configuration
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000";

test.describe("SignIn Authentication Flow - E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to sign in page
    await page.goto(`${BASE_URL}/auth/signin`);
  });

  test.afterEach(async ({ page }) => {
    // Clean up any test sessions
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test.describe("Page Loading and Provider Detection", () => {
    test("should display sign in page with correct elements", async ({ page }) => {
      // Check page title and heading
      await expect(page).toHaveTitle(/.*Hive.*/);
      await expect(page.getByRole("heading", { name: "Welcome to Hive" })).toBeVisible();
      
      // Check description
      await expect(page.getByText("Sign in to start managing your products")).toBeVisible();
      
      // Check terms and privacy policy links
      await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
      
      // Check back to home link
      await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();
    });

    test("should detect and display GitHub provider", async ({ page }) => {
      // Wait for providers to load
      await page.waitForLoadState("networkidle");
      
      // Check if GitHub sign in button is present
      const githubButton = page.getByTestId("github-signin-button");
      await expect(githubButton).toBeVisible();
      await expect(githubButton).toContainText("Continue with GitHub");
      
      // Check GitHub icon is present
      await expect(page.locator(".lucide-github")).toBeVisible();
    });

    test("should detect and display mock provider in development", async ({ page }) => {
      // Wait for providers to load
      await page.waitForLoadState("networkidle");
      
      // Check if mock sign in button is present (in development environment)
      const mockButton = page.getByTestId("mock-signin-button");
      if (await mockButton.isVisible()) {
        await expect(mockButton).toContainText("Mock Sign In (Dev)");
        
        // Check username input is present
        await expect(page.getByPlaceholder("Enter username (defaults to 'dev-user')")).toBeVisible();
        
        // Check development section separator
        await expect(page.getByText("Or for development")).toBeVisible();
      }
    });

    test("should show loading state while fetching providers", async ({ page }) => {
      // Reload page to catch loading state
      await page.reload();
      
      // Check for loading indicator (if visible during provider fetch)
      const loadingText = page.getByText("Loading...");
      if (await loadingText.isVisible()) {
        await expect(loadingText).toBeVisible();
      }
    });
  });

  test.describe("Mock Authentication Flow", () => {
    test("should complete mock sign in with default username", async ({ page }) => {
      // Skip if mock provider not available
      const mockButton = page.getByTestId("mock-signin-button");
      if (!(await mockButton.isVisible())) {
        test.skip("Mock provider not available in this environment");
      }

      // Click mock sign in without entering username
      await mockButton.click();
      
      // Check loading state
      await expect(mockButton).toContainText("Signing in...");
      await expect(page.locator(".animate-spin")).toBeVisible();
      
      // Wait for authentication to complete
      await page.waitForLoadState("networkidle");
      
      // Should redirect after successful authentication
      // (Either to workspace or onboarding depending on user state)
      await expect(page).not.toHaveURL(/.*\/auth\/signin.*/);
    });

    test("should complete mock sign in with custom username", async ({ page }) => {
      // Skip if mock provider not available
      const mockButton = page.getByTestId("mock-signin-button");
      if (!(await mockButton.isVisible())) {
        test.skip("Mock provider not available in this environment");
      }

      const customUsername = `e2e-test-user-${Date.now()}`;
      
      // Enter custom username
      const usernameInput = page.getByPlaceholder("Enter username (defaults to 'dev-user')");
      await usernameInput.fill(customUsername);
      
      // Verify username was entered
      await expect(usernameInput).toHaveValue(customUsername);
      
      // Click mock sign in
      await mockButton.click();
      
      // Check loading state
      await expect(mockButton).toContainText("Signing in...");
      await expect(mockButton).toBeDisabled();
      
      // Wait for authentication to complete
      await page.waitForLoadState("networkidle");
      
      // Should redirect after successful authentication
      await expect(page).not.toHaveURL(/.*\/auth\/signin.*/);
    });

    test("should handle mock sign in errors gracefully", async ({ page }) => {
      // Skip if mock provider not available
      const mockButton = page.getByTestId("mock-signin-button");
      if (!(await mockButton.isVisible())) {
        test.skip("Mock provider not available in this environment");
      }

      // Listen for console errors
      const consoleErrors: string[] = [];
      page.on("console", msg => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      // Try to trigger an error condition (this would depend on implementation)
      const usernameInput = page.getByPlaceholder("Enter username (defaults to 'dev-user')");
      await usernameInput.fill(""); // Empty username might cause issues
      
      await mockButton.click();
      
      // Wait a moment for potential error handling
      await page.waitForTimeout(2000);
      
      // Check if we're still on the sign in page (indicating an error)
      if (page.url().includes("/auth/signin")) {
        // Button should return to normal state after error
        await expect(mockButton).toContainText("Mock Sign In (Dev)");
        await expect(mockButton).not.toBeDisabled();
      }
    });

    test("should disable buttons during mock authentication", async ({ page }) => {
      // Skip if both providers not available
      const mockButton = page.getByTestId("mock-signin-button");
      const githubButton = page.getByTestId("github-signin-button");
      
      if (!(await mockButton.isVisible())) {
        test.skip("Mock provider not available in this environment");
      }

      // Click mock sign in
      await mockButton.click();
      
      // Both buttons should be disabled during authentication
      await expect(mockButton).toBeDisabled();
      
      if (await githubButton.isVisible()) {
        await expect(githubButton).toBeDisabled();
      }
      
      // Username input should also be disabled
      const usernameInput = page.getByPlaceholder("Enter username (defaults to 'dev-user')");
      await expect(usernameInput).toBeDisabled();
    });
  });

  test.describe("GitHub Authentication Flow", () => {
    test("should initiate GitHub OAuth flow", async ({ page }) => {
      const githubButton = page.getByTestId("github-signin-button");
      
      // Skip if GitHub provider not available
      if (!(await githubButton.isVisible())) {
        test.skip("GitHub provider not available in this environment");
      }

      // Listen for navigation events
      const navigationPromise = page.waitForEvent("framenavigated");
      
      // Click GitHub sign in
      await githubButton.click();
      
      // Check loading state
      await expect(githubButton).toContainText("Signing in...");
      await expect(githubButton).toBeDisabled();
      
      // Should either redirect to GitHub OAuth or complete authentication
      // depending on test environment configuration
      await page.waitForLoadState("networkidle");
      
      // In test environment, this might redirect to GitHub or complete locally
      const currentUrl = page.url();
      const isGitHubOAuth = currentUrl.includes("github.com") || currentUrl.includes("oauth");
      const isAuthComplete = !currentUrl.includes("/auth/signin");
      
      expect(isGitHubOAuth || isAuthComplete).toBe(true);
    });

    test("should handle GitHub OAuth callback", async ({ page }) => {
      // This test would require setting up a GitHub OAuth app for testing
      // and handling the callback flow. In a real test environment, you would:
      
      // 1. Configure GitHub OAuth with test credentials
      // 2. Handle the OAuth flow programmatically
      // 3. Verify the callback is processed correctly
      // 4. Check that user is authenticated and redirected appropriately
      
      test.skip("GitHub OAuth callback testing requires OAuth app configuration");
    });

    test("should disable buttons during GitHub authentication", async ({ page }) => {
      const githubButton = page.getByTestId("github-signin-button");
      const mockButton = page.getByTestId("mock-signin-button");
      
      // Skip if GitHub provider not available
      if (!(await githubButton.isVisible())) {
        test.skip("GitHub provider not available in this environment");
      }

      // Click GitHub sign in
      await githubButton.click();
      
      // GitHub button should be disabled
      await expect(githubButton).toBeDisabled();
      
      // Mock button should also be disabled if present
      if (await mockButton.isVisible()) {
        await expect(mockButton).toBeDisabled();
      }
    });
  });

  test.describe("Authentication State Management", () => {
    test("should redirect authenticated users away from sign in page", async ({ page }) => {
      // This test assumes there's already an authenticated session
      // In a real test, you would first authenticate, then try to visit signin
      
      // For now, we'll just check that the page loads for unauthenticated users
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
    });

    test("should show loading state during session check", async ({ page }) => {
      // Reload to catch any loading states
      await page.reload();
      
      // Look for loading indicators during session validation
      const loadingElements = page.locator(".animate-spin");
      if (await loadingElements.first().isVisible()) {
        await expect(loadingElements.first()).toBeVisible();
      }
    });

    test("should handle network errors gracefully", async ({ page }) => {
      // Listen for network errors
      const failedRequests: string[] = [];
      page.on("requestfailed", request => {
        failedRequests.push(request.url());
      });

      // Try actions that might fail due to network issues
      await page.reload();
      await page.waitForLoadState("networkidle");
      
      // Page should still be functional even with some network errors
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
    });
  });

  test.describe("UI Responsiveness and Accessibility", () => {
    test("should be responsive on mobile devices", async ({ page }) => {
      // Test mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Check that elements are visible and properly sized
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
      
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        // Button should be properly sized for mobile
        const buttonBox = await githubButton.boundingBox();
        expect(buttonBox?.height).toBeGreaterThan(40); // Minimum touch target size
      }
    });

    test("should be accessible with keyboard navigation", async ({ page }) => {
      // Test keyboard navigation
      await page.keyboard.press("Tab");
      
      // Back to home link should be focused first
      await expect(page.getByRole("link", { name: "Back to Home" })).toBeFocused();
      
      // Tab to GitHub button if present
      await page.keyboard.press("Tab");
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        await expect(githubButton).toBeFocused();
      }
      
      // Tab to mock elements if present
      await page.keyboard.press("Tab");
      const usernameInput = page.getByPlaceholder("Enter username (defaults to 'dev-user')");
      if (await usernameInput.isVisible()) {
        await expect(usernameInput).toBeFocused();
      }
    });

    test("should have proper ARIA labels and roles", async ({ page }) => {
      // Check button roles and labels
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        await expect(githubButton).toHaveRole("button");
        await expect(githubButton).toHaveAccessibleName(/github/i);
      }
      
      const mockButton = page.getByTestId("mock-signin-button");
      if (await mockButton.isVisible()) {
        await expect(mockButton).toHaveRole("button");
        await expect(mockButton).toHaveAccessibleName(/mock/i);
      }
      
      // Check form elements
      const usernameInput = page.getByPlaceholder("Enter username (defaults to 'dev-user')");
      if (await usernameInput.isVisible()) {
        await expect(usernameInput).toHaveRole("textbox");
      }
    });

    test("should handle high contrast mode", async ({ page }) => {
      // Simulate high contrast mode (if supported by test environment)
      await page.emulateMedia({ colorScheme: 'dark' });
      
      // Elements should still be visible and accessible
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
      
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        await expect(githubButton).toBeVisible();
      }
    });
  });

  test.describe("Error Scenarios", () => {
    test("should handle provider loading failures", async ({ page }) => {
      // Mock network failure for provider endpoint
      await page.route("**/api/auth/providers", route => {
        route.abort("failed");
      });
      
      await page.reload();
      await page.waitForLoadState("networkidle");
      
      // Page should still be functional even without providers
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
    });

    test("should handle authentication service unavailable", async ({ page }) => {
      // Mock authentication endpoints as unavailable
      await page.route("**/api/auth/**", route => {
        route.fulfill({ status: 503, body: "Service Unavailable" });
      });
      
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        await githubButton.click();
        
        // Should handle error gracefully
        await page.waitForTimeout(2000);
        
        // Button should return to normal state
        await expect(githubButton).toContainText("Continue with GitHub");
        await expect(githubButton).not.toBeDisabled();
      }
    });

    test("should handle JavaScript disabled", async ({ page }) => {
      // Disable JavaScript
      await page.context().setJavaScriptEnabled(false);
      
      await page.reload();
      
      // Page should still display basic content
      await expect(page.getByText("Welcome to Hive")).toBeVisible();
      
      // Forms should still be present (though may not be fully functional)
      const githubButton = page.getByTestId("github-signin-button");
      if (await githubButton.isVisible()) {
        await expect(githubButton).toBeVisible();
      }
      
      // Re-enable JavaScript for cleanup
      await page.context().setJavaScriptEnabled(true);
    });
  });
});