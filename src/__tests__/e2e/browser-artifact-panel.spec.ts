import { test, expect, Page } from "@playwright/test";

test.describe("BrowserArtifactPanel E2E Tests", () => {
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    
    // Navigate to the application
    await page.goto("http://localhost:3000");
    
    // Authenticate using mock sign-in
    const signInButton = page.locator('[data-testid="mock-signin-button"]');
    await signInButton.waitFor({ state: "visible" });
    await signInButton.click();
    
    // Wait for authentication to complete and dashboard to load
    await page.waitForSelector('button:has-text("Settings")', { state: "visible" });
  });

  test.describe("Tab Switching Functionality", () => {
    test("should display single browser artifact without tab navigation", async () => {
      // Navigate to a task with a single browser artifact
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      // Wait for the artifacts panel to load
      await page.waitForSelector(".artifacts-panel");
      
      // Should show the Live Preview tab is active
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await expect(livePreviewTab).toBeVisible();
      
      // Should not show preview tab navigation for single artifact
      const previewTab1 = page.locator('button:has-text("Preview 1")');
      const previewTab2 = page.locator('button:has-text("Preview 2")');
      
      await expect(previewTab1).not.toBeVisible();
      await expect(previewTab2).not.toBeVisible();
      
      // Should show iframe with artifact content
      const iframe = page.locator('iframe[title*="Live Preview"]');
      await expect(iframe).toBeVisible();
    });

    test("should display tab navigation for multiple browser artifacts", async () => {
      // Navigate to a task with multiple browser artifacts
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-multiple");
      
      // Wait for the artifacts panel to load
      await page.waitForSelector(".artifacts-panel");
      
      // Should show the Live Preview tab
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await expect(livePreviewTab).toBeVisible();
      await livePreviewTab.click();
      
      // Should show preview tab navigation for multiple artifacts
      const previewTab1 = page.locator('button:has-text("Preview 1")');
      const previewTab2 = page.locator('button:has-text("Preview 2")');
      
      await expect(previewTab1).toBeVisible();
      await expect(previewTab2).toBeVisible();
      
      // First tab should be active by default
      await expect(previewTab1).toHaveClass(/border-primary/);
      await expect(previewTab2).toHaveClass(/border-transparent/);
    });

    test("should switch tabs when clicked", async () => {
      // Navigate to a task with multiple browser artifacts
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-multiple");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      const previewTab1 = page.locator('button:has-text("Preview 1")');
      const previewTab2 = page.locator('button:has-text("Preview 2")');
      
      // Verify initial state
      await expect(previewTab1).toHaveClass(/border-primary/);
      await expect(previewTab2).toHaveClass(/border-transparent/);
      
      // Click second tab
      await previewTab2.click();
      
      // Verify tab switch
      await expect(previewTab1).toHaveClass(/border-transparent/);
      await expect(previewTab2).toHaveClass(/border-primary/);
      
      // Click back to first tab
      await previewTab1.click();
      
      // Verify tab switch back
      await expect(previewTab1).toHaveClass(/border-primary/);
      await expect(previewTab2).toHaveClass(/border-transparent/);
    });

    test("should display different content for different tabs", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-multiple");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Get the URL display for first tab
      const urlDisplay = page.locator(".flex.items-center.gap-2.min-w-0 span");
      const initialUrl = await urlDisplay.textContent();
      
      // Switch to second tab
      const previewTab2 = page.locator('button:has-text("Preview 2")');
      await previewTab2.click();
      
      // URL should change for second tab
      const secondUrl = await urlDisplay.textContent();
      expect(secondUrl).not.toBe(initialUrl);
      
      // Switch back to first tab
      const previewTab1 = page.locator('button:has-text("Preview 1")');
      await previewTab1.click();
      
      // URL should be back to original
      const backToFirstUrl = await urlDisplay.textContent();
      expect(backToFirstUrl).toBe(initialUrl);
    });
  });

  test.describe("Debug Mode Functionality", () => {
    test("should toggle debug mode when debug button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Find debug button by icon or tooltip
      const debugButton = page.locator('button[title="Debug Element"]');
      await expect(debugButton).toBeVisible();
      
      // Initially debug overlay should not be visible/active
      const debugOverlay = page.locator('[data-testid="debug-overlay"]');
      await expect(debugOverlay).toHaveAttribute("data-active", "false");
      
      // Click debug button to enable debug mode
      await debugButton.click();
      
      // Debug overlay should now be active
      await expect(debugOverlay).toHaveAttribute("data-active", "true");
      
      // Click debug button again to disable debug mode
      await debugButton.click();
      
      // Debug overlay should be inactive again
      await expect(debugOverlay).toHaveAttribute("data-active", "false");
    });

    test("should show debug overlay UI when debug mode is active", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      const debugButton = page.locator('button[title="Debug Element"]');
      await debugButton.click();
      
      // Debug overlay should be visible and active
      const debugOverlay = page.locator('[data-testid="debug-overlay"]');
      await expect(debugOverlay).toBeVisible();
      await expect(debugOverlay).toHaveAttribute("data-active", "true");
      
      // Should show debug mode indicator
      const debugIndicator = page.locator("text=/Debug Mode:/");
      await expect(debugIndicator).toBeVisible();
    });

    test("should disable debug mode when switching tabs", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-multiple");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Enable debug mode
      const debugButton = page.locator('button[title="Debug Element"]');
      await debugButton.click();
      
      const debugOverlay = page.locator('[data-testid="debug-overlay"]');
      await expect(debugOverlay).toHaveAttribute("data-active", "true");
      
      // Switch tabs
      const previewTab2 = page.locator('button:has-text("Preview 2")');
      await previewTab2.click();
      
      // Debug mode should be automatically disabled
      await expect(debugOverlay).toHaveAttribute("data-active", "false");
    });

    test("should handle debug selection interaction", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Enable debug mode
      const debugButton = page.locator('button[title="Debug Element"]');
      await debugButton.click();
      
      const debugOverlay = page.locator('[data-testid="debug-overlay"]');
      await expect(debugOverlay).toHaveAttribute("data-active", "true");
      
      // Click on debug overlay to simulate element selection
      await debugOverlay.click();
      
      // Should show submitting state
      await expect(debugOverlay).toHaveAttribute("data-submitting", "true");
      
      // Wait for debug submission to complete
      await page.waitForTimeout(1000);
      
      // Debug mode should be disabled after selection
      await expect(debugOverlay).toHaveAttribute("data-active", "false");
    });
  });

  test.describe("Recording Logic Functionality", () => {
    test("should show recording controls when staktrak is setup", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Wait for staktrak to setup (simulate setup message)
      await page.waitForTimeout(1000);
      
      // Should show record button
      const recordButton = page.locator('button[title*="recording"]');
      await expect(recordButton).toBeVisible();
    });

    test("should start recording when record button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      await page.waitForTimeout(1000); // Wait for staktrak setup
      
      // Click start recording button (circle icon)
      const recordButton = page.locator('button[title="Start recording"]');
      await recordButton.click();
      
      // Should change to stop recording button (square icon) 
      const stopButton = page.locator('button[title="Stop recording"]');
      await expect(stopButton).toBeVisible();
      
      // Should show assertion mode button when recording
      const assertionButton = page.locator('button[title*="assertion mode"]');
      await expect(assertionButton).toBeVisible();
    });

    test("should show assertion mode controls when recording", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      await page.waitForTimeout(1000);
      
      // Start recording
      const recordButton = page.locator('button[title="Start recording"]');
      await recordButton.click();
      
      // Should show assertion mode button
      const assertionButton = page.locator('button[title="Enable assertion mode"]');
      await expect(assertionButton).toBeVisible();
      
      // Click to enable assertion mode
      await assertionButton.click();
      
      // Should change to disable assertion mode
      const disableAssertionButton = page.locator('button[title="Disable assertion mode"]');
      await expect(disableAssertionButton).toBeVisible();
      
      // Button should have active styling
      await expect(disableAssertionButton).toHaveClass(/bg-blue-100|bg-blue-900/);
    });

    test("should stop recording and open test modal", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      await page.waitForTimeout(1000);
      
      // Start recording
      const recordButton = page.locator('button[title="Start recording"]');
      await recordButton.click();
      
      // Stop recording
      const stopButton = page.locator('button[title="Stop recording"]');
      await stopButton.click();
      
      // Test manager modal should open
      const testModal = page.locator('[data-testid="test-manager-modal"]');
      await expect(testModal).toHaveAttribute("data-open", "true");
      
      // Should be back to start recording button
      await expect(recordButton).toBeVisible();
    });
  });

  test.describe("Replay Logic Functionality", () => {
    test("should show replay button when playwright test is available", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-with-test");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Wait for generated test to be available
      await page.waitForTimeout(2000);
      
      // Should show replay button when test is available
      const replayButton = page.locator('button[title="Start replay"]');
      await expect(replayButton).toBeVisible();
    });

    test("should start replay when replay button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-with-test");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      await page.waitForTimeout(2000);
      
      const replayButton = page.locator('button[title="Start replay"]');
      await replayButton.click();
      
      // Should change to stop replay button (pause icon)
      const stopReplayButton = page.locator('button[title="Stop replay"]');
      await expect(stopReplayButton).toBeVisible();
      
      // Should have active replay styling
      await expect(stopReplayButton).toHaveClass(/bg-orange-100|bg-orange-900/);
    });

    test("should stop replay when stop button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-with-test");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      await page.waitForTimeout(2000);
      
      // Start replay
      const replayButton = page.locator('button[title="Start replay"]');
      await replayButton.click();
      
      // Stop replay
      const stopReplayButton = page.locator('button[title="Stop replay"]');
      await stopReplayButton.click();
      
      // Should be back to start replay button
      await expect(replayButton).toBeVisible();
    });
  });

  test.describe("Additional Functionality", () => {
    test("should open test manager modal when tests button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Click tests button
      const testsButton = page.locator('button[title="Tests"]');
      await testsButton.click();
      
      // Test modal should open
      const testModal = page.locator('[data-testid="test-manager-modal"]');
      await expect(testModal).toHaveAttribute("data-open", "true");
      
      // Can close modal
      const closeButton = page.locator('button:has-text("Close Modal")');
      await closeButton.click();
      
      await expect(testModal).toHaveAttribute("data-open", "false");
    });

    test("should refresh iframe when refresh button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      const iframe = page.locator('iframe[title*="Live Preview"]');
      const initialSrc = await iframe.getAttribute("src");
      
      // Click refresh button
      const refreshButton = page.locator('button[title="Refresh"]');
      await refreshButton.click();
      
      // Wait for potential refresh
      await page.waitForTimeout(500);
      
      // Iframe should still be present (may have different key)
      await expect(iframe).toBeVisible();
    });

    test("should open external link when external link button is clicked", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/browser-artifact-single");
      
      await page.waitForSelector(".artifacts-panel");
      const livePreviewTab = page.locator('[data-value="BROWSER"]');
      await livePreviewTab.click();
      
      // Set up new page listener
      const [newPage] = await Promise.all([
        page.context().waitForEvent("page"),
        page.locator('button[title="Open in new tab"]').click()
      ]);
      
      // New page should have opened
      expect(newPage).toBeTruthy();
      
      // Close the new page
      await newPage.close();
    });

    test("should handle IDE mode correctly", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/ide-artifact");
      
      await page.waitForSelector(".artifacts-panel");
      const ideTab = page.locator('[data-value="IDE"]');
      await ideTab.click();
      
      // In IDE mode, toolbar should not be visible
      const toolbar = page.locator(".flex.items-center.justify-between.px-4.py-2");
      await expect(toolbar).not.toBeVisible();
      
      // Iframe should still be visible
      const iframe = page.locator('iframe[title*="Live Preview"]');
      await expect(iframe).toBeVisible();
    });

    test("should handle empty artifacts array gracefully", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/no-artifacts");
      
      await page.waitForSelector(".artifacts-panel");
      
      // Should not show BROWSER tab if no browser artifacts
      const browserTab = page.locator('[data-value="BROWSER"]');
      await expect(browserTab).not.toBeVisible();
    });
  });

  test.describe("Integration with Parent ArtifactsPanel", () => {
    test("should be properly integrated within ArtifactsPanel tabs", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/mixed-artifacts");
      
      await page.waitForSelector(".artifacts-panel");
      
      // Should show multiple artifact type tabs
      const codeTab = page.locator('[data-value="CODE"]');
      const browserTab = page.locator('[data-value="BROWSER"]');
      
      await expect(codeTab).toBeVisible();
      await expect(browserTab).toBeVisible();
      
      // Click browser tab
      await browserTab.click();
      
      // BrowserArtifactPanel should be rendered
      const iframe = page.locator('iframe[title*="Live Preview"]');
      await expect(iframe).toBeVisible();
      
      // Switch to code tab
      await codeTab.click();
      
      // BrowserArtifactPanel should be hidden
      await expect(iframe).not.toBeVisible();
    });

    test("should maintain state when switching between artifact types", async () => {
      await page.goto("http://localhost:3000/w/test-workspace/task/mixed-artifacts");
      
      await page.waitForSelector(".artifacts-panel");
      
      const browserTab = page.locator('[data-value="BROWSER"]');
      await browserTab.click();
      
      // Enable debug mode
      const debugButton = page.locator('button[title="Debug Element"]');
      await debugButton.click();
      
      // Switch to code tab
      const codeTab = page.locator('[data-value="CODE"]');
      await codeTab.click();
      
      // Switch back to browser tab
      await browserTab.click();
      
      // Debug mode should be maintained/reset appropriately
      const debugOverlay = page.locator('[data-testid="debug-overlay"]');
      await expect(debugOverlay).toBeVisible();
    });
  });
});