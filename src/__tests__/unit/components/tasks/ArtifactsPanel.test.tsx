import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useEffect } from "react";

/**
 * Unit tests for ArtifactsPanel race condition fix logic.
 * 
 * These tests verify the state management pattern that prevents the TASKS tab
 * from disappearing during the isApiCalling → isRunInProgress handoff.
 */
describe("ArtifactsPanel - Generate Tasks Race Condition Logic", () => {
  /**
   * Simulates the core logic of ArtifactsPanel's state management
   * for the TASKS tab visibility during generation.
   */
  function useArtifactsPanelLogic(initialHasTasks = false, initialRunStatus: string | null = null) {
    const [isApiCalling, setIsApiCalling] = useState(false);
    const [hasInitiatedGeneration, setHasInitiatedGeneration] = useState(false);
    const [hasTasks, setHasTasks] = useState(initialHasTasks);
    const [runStatus, setRunStatus] = useState<string | null>(initialRunStatus);

    // Derived state
    const isRunInProgress = runStatus === "IN_PROGRESS" || runStatus === "PENDING";
    const isRunFailed = runStatus === "FAILED" || runStatus === "ERROR";
    const isGenerating = isApiCalling || isRunInProgress;
    const showTasksTab = hasTasks || isGenerating || hasInitiatedGeneration;

    // Reset hasInitiatedGeneration when done
    useEffect(() => {
      if (hasTasks || isRunFailed) {
        setHasInitiatedGeneration(false);
      }
    }, [hasTasks, isRunFailed]);

    const handleGenerateTasks = () => {
      setIsApiCalling(true);
      setHasInitiatedGeneration(true);
      // Simulate API call completion
      setTimeout(() => setIsApiCalling(false), 100);
    };

    return {
      isApiCalling,
      hasInitiatedGeneration,
      hasTasks,
      runStatus,
      isGenerating,
      showTasksTab,
      isRunFailed,
      setIsApiCalling,
      setHasInitiatedGeneration,
      setHasTasks,
      setRunStatus,
      handleGenerateTasks,
    };
  }

  test("showTasksTab remains true during isApiCalling → isRunInProgress handoff", async () => {
    const { result } = renderHook(() => useArtifactsPanelLogic());

    // Initial state: no tasks, no generation
    expect(result.current.showTasksTab).toBe(false);

    // User clicks "Generate Tasks"
    act(() => {
      result.current.handleGenerateTasks();
    });

    // isApiCalling = true, hasInitiatedGeneration = true
    expect(result.current.isApiCalling).toBe(true);
    expect(result.current.hasInitiatedGeneration).toBe(true);
    expect(result.current.showTasksTab).toBe(true); // ✓ TASKS tab visible

    // Simulate race condition: API call completes, but run status not yet updated
    act(() => {
      result.current.setIsApiCalling(false);
    });

    // CRITICAL: showTasksTab should STILL be true because hasInitiatedGeneration = true
    expect(result.current.isApiCalling).toBe(false);
    expect(result.current.hasInitiatedGeneration).toBe(true);
    expect(result.current.showTasksTab).toBe(true); // ✓ No flicker!

    // Pusher event arrives: run is now IN_PROGRESS
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
    });

    // showTasksTab should remain true (now via isGenerating)
    expect(result.current.isGenerating).toBe(true);
    expect(result.current.showTasksTab).toBe(true); // ✓ Still visible

    // Run completes, tasks appear
    act(() => {
      result.current.setRunStatus("COMPLETED");
      result.current.setHasTasks(true);
    });

    // showTasksTab should remain true (now via hasTasks)
    // hasInitiatedGeneration should reset to false
    expect(result.current.hasTasks).toBe(true);
    expect(result.current.hasInitiatedGeneration).toBe(false);
    expect(result.current.showTasksTab).toBe(true); // ✓ Still visible
  });

  test("hasInitiatedGeneration resets when hasTasks becomes true", () => {
    const { result } = renderHook(() => useArtifactsPanelLogic());

    // Start generation
    act(() => {
      result.current.handleGenerateTasks();
    });

    expect(result.current.hasInitiatedGeneration).toBe(true);

    // Tasks appear
    act(() => {
      result.current.setHasTasks(true);
    });

    // hasInitiatedGeneration should reset
    expect(result.current.hasInitiatedGeneration).toBe(false);
    expect(result.current.showTasksTab).toBe(true); // Still visible via hasTasks
  });

  test("hasInitiatedGeneration resets when isRunFailed becomes true", () => {
    const { result } = renderHook(() => useArtifactsPanelLogic());

    // Start generation
    act(() => {
      result.current.handleGenerateTasks();
    });

    expect(result.current.hasInitiatedGeneration).toBe(true);
    expect(result.current.showTasksTab).toBe(true);

    // Run fails
    act(() => {
      result.current.setIsApiCalling(false);
      result.current.setRunStatus("FAILED");
    });

    // hasInitiatedGeneration should reset
    expect(result.current.hasInitiatedGeneration).toBe(false);
    expect(result.current.isRunFailed).toBe(true);
    
    // showTasksTab should still be true to show the failure state
    // (in the real component, this would show error UI)
    expect(result.current.showTasksTab).toBe(false); // Correct: no tasks, no active generation
  });

  test("showTasksTab calculation includes all three conditions", () => {
    const { result } = renderHook(() => useArtifactsPanelLogic());

    // Condition 1: hasTasks
    act(() => {
      result.current.setHasTasks(true);
    });
    expect(result.current.showTasksTab).toBe(true);

    // Reset
    act(() => {
      result.current.setHasTasks(false);
    });
    expect(result.current.showTasksTab).toBe(false);

    // Condition 2: isGenerating (via isApiCalling)
    act(() => {
      result.current.setIsApiCalling(true);
    });
    expect(result.current.showTasksTab).toBe(true);

    act(() => {
      result.current.setIsApiCalling(false);
    });
    expect(result.current.showTasksTab).toBe(false);

    // Condition 3: hasInitiatedGeneration
    act(() => {
      result.current.setHasInitiatedGeneration(true);
    });
    expect(result.current.showTasksTab).toBe(true);
  });

  test("hard refresh mid-generation: isGenerating is true from start", () => {
    // Simulate hard refresh: component mounts with run already IN_PROGRESS
    const { result } = renderHook(() => useArtifactsPanelLogic(false, "IN_PROGRESS"));

    // showTasksTab should be true immediately
    expect(result.current.isGenerating).toBe(true);
    expect(result.current.hasInitiatedGeneration).toBe(false); // Not set via button
    expect(result.current.showTasksTab).toBe(true); // Visible via isGenerating
  });

  test("auto-fallback guard: hasInitiatedGeneration prevents tab reset", () => {
    const { result } = renderHook(() => {
      const logic = useArtifactsPanelLogic();
      const [activeTab, setActiveTab] = useState<string>("PLAN");
      const [availableTabs, setAvailableTabs] = useState<string[]>(["PLAN"]);

      // Simulate the auto-fallback useEffect from ArtifactsPanel
      useEffect(() => {
        if (availableTabs.length > 0 && (!activeTab || !availableTabs.includes(activeTab))) {
          // Guard: don't reset if generation is active
          if (logic.hasInitiatedGeneration) return;
          setActiveTab(availableTabs[0]);
        }
      }, [availableTabs, activeTab, logic.hasInitiatedGeneration]);

      return { ...logic, activeTab, setActiveTab, availableTabs, setAvailableTabs };
    });

    // User clicks "Generate Tasks" → switch to TASKS tab
    act(() => {
      result.current.handleGenerateTasks();
      result.current.setActiveTab("TASKS");
      result.current.setAvailableTabs(["PLAN", "TASKS"]);
    });

    expect(result.current.activeTab).toBe("TASKS");
    expect(result.current.hasInitiatedGeneration).toBe(true);

    // Simulate race condition: API call completes, availableTabs changes
    act(() => {
      result.current.setIsApiCalling(false);
      // availableTabs might briefly not include TASKS
      result.current.setAvailableTabs(["PLAN"]);
    });

    // CRITICAL: activeTab should NOT reset to PLAN because hasInitiatedGeneration guards it
    expect(result.current.activeTab).toBe("TASKS"); // ✓ Not reset!
    expect(result.current.hasInitiatedGeneration).toBe(true);

    // After tasks appear, the guard can be lifted
    act(() => {
      result.current.setHasTasks(true);
      result.current.setAvailableTabs(["PLAN", "TASKS"]);
    });

    expect(result.current.hasInitiatedGeneration).toBe(false);
    expect(result.current.activeTab).toBe("TASKS"); // Still on TASKS
  });
});
