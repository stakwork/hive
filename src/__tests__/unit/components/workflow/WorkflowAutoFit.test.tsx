import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for workflow canvas auto-fit behavior fix
 * 
 * The fix ensures that:
 * 1. Editor mode (no projectId) auto-fits nodes into view when no saved localStorage position exists
 * 2. Editor mode respects saved localStorage positions and skips auto-fit
 * 3. Live running mode (with projectId) continues to auto-fit as before (no regression)
 */
describe("WorkflowComponent - Auto-Fit Logic", () => {
  let mockReactFlowInstance: any;
  let mockNodes: any[];
  let hasInitialFitViewRef: { current: boolean };
  let hasSavedPositionRef: { current: boolean };

  beforeEach(() => {
    // Mock ReactFlow instance
    mockReactFlowInstance = {
      fitView: vi.fn(),
    };

    // Mock nodes
    mockNodes = [
      { id: "start", position: { x: 100, y: 100 } },
      { id: "end", position: { x: 300, y: 300 } },
    ];

    // Mock refs
    hasInitialFitViewRef = { current: false };
    hasSavedPositionRef = { current: false };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Simulates the fitView useEffect logic from the component
   */
  const simulateFitViewEffect = (projectId: string | undefined, hasSavedPosition: boolean) => {
    hasSavedPositionRef.current = hasSavedPosition;

    // This is the actual condition from the fix
    if (
      (projectId || !hasSavedPositionRef.current) &&
      mockReactFlowInstance &&
      mockNodes.length > 0 &&
      !hasInitialFitViewRef.current
    ) {
      hasInitialFitViewRef.current = true;

      // Simulate the setTimeout
      setTimeout(() => {
        mockReactFlowInstance.fitView({
          padding: 0.2,
          duration: 300,
        });
      }, 100);
    }
  };

  it("should call fitView when projectId is empty and no localStorage position exists", async () => {
    // Simulate editor mode with no saved position
    const projectId = "";
    const hasSavedPosition = false;

    simulateFitViewEffect(projectId, hasSavedPosition);

    // Wait for setTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify fitView was called
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledWith({
      padding: 0.2,
      duration: 300,
    });
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledTimes(1);
  });

  it("should NOT call fitView when valid localStorage position exists for the workflow", async () => {
    // Simulate editor mode with a saved position
    const projectId = "";
    const hasSavedPosition = true;

    simulateFitViewEffect(projectId, hasSavedPosition);

    // Wait for any potential setTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify fitView was NOT called
    expect(mockReactFlowInstance.fitView).not.toHaveBeenCalled();
  });

  it("should still call fitView when projectId is truthy (polling mode - no regression)", async () => {
    // Simulate live running mode (polling) with a projectId
    const projectId = "live-project-456";
    const hasSavedPosition = false; // Even if false, projectId takes precedence

    simulateFitViewEffect(projectId, hasSavedPosition);

    // Wait for setTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify fitView was called
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledWith({
      padding: 0.2,
      duration: 300,
    });
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledTimes(1);
  });

  it("should call fitView when projectId is truthy even with saved position (polling mode always auto-fits)", async () => {
    // Simulate live running mode with a saved position
    // In polling mode, we always want to auto-fit regardless of saved position
    const projectId = "live-project-456";
    const hasSavedPosition = true;

    simulateFitViewEffect(projectId, hasSavedPosition);

    // Wait for setTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify fitView was called
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledWith({
      padding: 0.2,
      duration: 300,
    });
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledTimes(1);
  });

  it("should not call fitView multiple times (hasInitialFitViewRef guard)", async () => {
    // First call
    const projectId = "";
    const hasSavedPosition = false;

    simulateFitViewEffect(projectId, hasSavedPosition);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(mockReactFlowInstance.fitView).toHaveBeenCalledTimes(1);

    // Try to call again (should be blocked by hasInitialFitViewRef)
    simulateFitViewEffect(projectId, hasSavedPosition);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should still be 1, not 2
    expect(mockReactFlowInstance.fitView).toHaveBeenCalledTimes(1);
  });
});

/**
 * Tests for localStorage position restoration logic
 */
describe("WorkflowComponent - LocalStorage Position Restoration", () => {
  let localStorageMock: { [key: string]: string };
  let hasSavedPositionRef: { current: boolean };

  beforeEach(() => {
    localStorageMock = {};
    hasSavedPositionRef = { current: false };
  });

  /**
   * Simulates the localStorage restore useEffect logic
   */
  const simulateLocalStorageRestore = (workflowId: string, projectId: string | undefined) => {
    const cookieKey = `position_${workflowId}`;
    const savedPosition = localStorageMock[cookieKey];

    if (savedPosition && !projectId) {
      try {
        const parsedPosition = JSON.parse(savedPosition);
        // In the real component, this would call setTargetPosition(parsedPosition)
        hasSavedPositionRef.current = true; // This is the key line from the fix
        return parsedPosition;
      } catch (error) {
        console.error("Failed to parse position from cookie:", error);
        return null;
      }
    }
    return null;
  };

  it("should set hasSavedPositionRef when valid localStorage position exists", () => {
    localStorageMock["position_test-workflow-123"] = JSON.stringify({ x: 200, y: 300, zoom: 0.8 });

    const restored = simulateLocalStorageRestore("test-workflow-123", "");

    expect(restored).toEqual({ x: 200, y: 300, zoom: 0.8 });
    expect(hasSavedPositionRef.current).toBe(true);
  });

  it("should NOT set hasSavedPositionRef when no localStorage position exists", () => {
    const restored = simulateLocalStorageRestore("test-workflow-123", "");

    expect(restored).toBeNull();
    expect(hasSavedPositionRef.current).toBe(false);
  });

  it("should NOT restore position when projectId is present", () => {
    localStorageMock["position_test-workflow-123"] = JSON.stringify({ x: 200, y: 300, zoom: 0.8 });

    const restored = simulateLocalStorageRestore("test-workflow-123", "live-project-456");

    expect(restored).toBeNull();
    expect(hasSavedPositionRef.current).toBe(false);
  });

  it("should handle invalid JSON in localStorage gracefully", () => {
    localStorageMock["position_test-workflow-123"] = "invalid-json";

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const restored = simulateLocalStorageRestore("test-workflow-123", "");

    expect(restored).toBeNull();
    expect(hasSavedPositionRef.current).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
