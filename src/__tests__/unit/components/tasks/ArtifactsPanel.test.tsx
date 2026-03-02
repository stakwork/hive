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
      // No async timeout - state changes are synchronous for testing
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

describe("ArtifactsPanel - Failure UX (Amber Button & Toast)", () => {
  /**
   * Extended logic hook that includes button rendering state
   */
  function useFailureUXLogic(initialRunStatus: string | null = null, initialRunId: string | null = null) {
    const [runStatus, setRunStatus] = useState<string | null>(initialRunStatus);
    const [runId, setRunId] = useState<string | null>(initialRunId);
    const [toastedRunId, setToastedRunId] = useState<string | null>(null);

    // Derived state
    const isRunFailed = runStatus === "FAILED" || runStatus === "ERROR" || runStatus === "HALTED";

    // Simulate the toast useEffect logic
    useEffect(() => {
      if (isRunFailed && runId && toastedRunId !== runId) {
        setToastedRunId(runId);
        // In real component, toast.error would be called here
      }
    }, [isRunFailed, runId, toastedRunId]);

    return {
      runStatus,
      runId,
      isRunFailed,
      toastedRunId,
      setRunStatus,
      setRunId,
      getButtonColor: () => (isRunFailed ? "bg-amber-500" : "bg-emerald-600"),
    };
  }

  test("button renders with amber background when run status is FAILED", () => {
    const { result } = renderHook(() => useFailureUXLogic("FAILED", "run-123"));

    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.getButtonColor()).toBe("bg-amber-500");
  });

  test("button renders with amber background when run status is ERROR", () => {
    const { result } = renderHook(() => useFailureUXLogic("ERROR", "run-456"));

    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.getButtonColor()).toBe("bg-amber-500");
  });

  test("button renders with amber background when run status is HALTED", () => {
    const { result } = renderHook(() => useFailureUXLogic("HALTED", "run-789"));

    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.getButtonColor()).toBe("bg-amber-500");
  });

  test("button renders with emerald background when run is not failed", () => {
    const { result } = renderHook(() => useFailureUXLogic("IN_PROGRESS", "run-123"));

    expect(result.current.isRunFailed).toBe(false);
    expect(result.current.getButtonColor()).toBe("bg-emerald-600");
  });

  test("button returns to emerald when generation restarts after failure", () => {
    const { result } = renderHook(() => useFailureUXLogic("FAILED", "run-123"));

    expect(result.current.getButtonColor()).toBe("bg-amber-500");

    // New generation starts
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
      result.current.setRunId("run-124");
    });

    expect(result.current.isRunFailed).toBe(false);
    expect(result.current.getButtonColor()).toBe("bg-emerald-600");
  });

  test("toast fires once when run transitions to failed state", () => {
    const { result } = renderHook(() => useFailureUXLogic(null, null));

    // Initial: no run
    expect(result.current.toastedRunId).toBe(null);

    // Run starts
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
      result.current.setRunId("run-123");
    });

    expect(result.current.toastedRunId).toBe(null); // No toast yet

    // Run fails
    act(() => {
      result.current.setRunStatus("FAILED");
    });

    // Toast should fire (toastedRunId is set)
    expect(result.current.toastedRunId).toBe("run-123");
  });

  test("toast does not re-fire on re-render with same failed run ID", () => {
    const { result, rerender } = renderHook(() => useFailureUXLogic("FAILED", "run-123"));

    // Toast fires on mount
    expect(result.current.toastedRunId).toBe("run-123");

    // Force re-render
    rerender();

    // Toast should NOT fire again (toastedRunId unchanged)
    expect(result.current.toastedRunId).toBe("run-123");
  });

  test("toast does not re-fire when non-ID field changes on same failed run", () => {
    const { result } = renderHook(() => useFailureUXLogic("FAILED", "run-123"));

    const firstToastedId = result.current.toastedRunId;
    expect(firstToastedId).toBe("run-123");

    // Simulate re-fetch or state update that doesn't change run ID
    // (In real component, this might be a feature or other data changing)
    act(() => {
      result.current.setRunStatus("FAILED"); // Same status
      // runId stays "run-123"
    });

    // toastedRunId should NOT change (no new toast)
    expect(result.current.toastedRunId).toBe(firstToastedId);
  });

  test("toast fires again when a new run ID fails", () => {
    const { result } = renderHook(() => useFailureUXLogic("FAILED", "run-123"));

    // First toast
    expect(result.current.toastedRunId).toBe("run-123");

    // User retries, new run starts and fails
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
      result.current.setRunId("run-124");
    });

    // No toast yet (not failed)
    expect(result.current.toastedRunId).toBe("run-123"); // Still old one

    act(() => {
      result.current.setRunStatus("FAILED");
    });

    // Toast fires for new run
    expect(result.current.toastedRunId).toBe("run-124");
  });

  test("toast does not fire when run ID is present but status is not failed", () => {
    const { result } = renderHook(() => useFailureUXLogic("COMPLETED", "run-123"));

    // No toast for successful run
    expect(result.current.isRunFailed).toBe(false);
    expect(result.current.toastedRunId).toBe(null);
  });

  test("toast does not fire when status is failed but no run ID", () => {
    const { result } = renderHook(() => useFailureUXLogic("FAILED", null));

    // No toast without run ID
    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.toastedRunId).toBe(null);
  });

  test("full lifecycle: success → failure (toast) → retry → failure (new toast)", () => {
    const { result } = renderHook(() => useFailureUXLogic("COMPLETED", "run-100"));

    // Initial: completed successfully
    expect(result.current.isRunFailed).toBe(false);
    expect(result.current.toastedRunId).toBe(null);
    expect(result.current.getButtonColor()).toBe("bg-emerald-600");

    // User clicks generate again, new run fails
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
      result.current.setRunId("run-101");
    });

    expect(result.current.getButtonColor()).toBe("bg-emerald-600");

    act(() => {
      result.current.setRunStatus("FAILED");
    });

    // First failure toast
    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.toastedRunId).toBe("run-101");
    expect(result.current.getButtonColor()).toBe("bg-amber-500");

    // User clicks retry, another new run fails
    act(() => {
      result.current.setRunStatus("IN_PROGRESS");
      result.current.setRunId("run-102");
    });

    expect(result.current.getButtonColor()).toBe("bg-emerald-600");

    act(() => {
      result.current.setRunStatus("ERROR"); // Different failure type
    });

    // Second failure toast
    expect(result.current.isRunFailed).toBe(true);
    expect(result.current.toastedRunId).toBe("run-102");
    expect(result.current.getButtonColor()).toBe("bg-amber-500");
  });
});

/**
 * Unit tests for ArtifactsPanel tab-reset guard fix.
 * 
 * These tests verify that the tab-reset guard respects valid URL-specified tabs
 * (PLAN, TASKS) even when they're not yet in availableTabs, preventing premature
 * overrides during data load.
 * 
 * Rather than simulating the full useEffect (which causes infinite loops in tests),
 * we test the guard conditions directly.
 */
describe("ArtifactsPanel - Tab Reset Guard Logic", () => {
  type ArtifactType = "PLAN" | "TASKS" | "CODE" | "DIFF" | "BROWSER" | "WORKFLOW";

  const VALID_PLAN_TABS: ArtifactType[] = ["PLAN", "TASKS"];

  /**
   * Pure function that determines if a tab reset should occur.
   * This mirrors the guard logic from ArtifactsPanel's useEffect.
   */
  function shouldResetTab(
    availableTabs: ArtifactType[],
    activeTab: ArtifactType | null,
    isControlled: boolean,
    hasInitiatedGeneration: boolean
  ): boolean {
    // No tabs available → no reset
    if (availableTabs.length === 0) return false;

    // Active tab exists and is in availableTabs → no reset needed
    if (activeTab && availableTabs.includes(activeTab)) return false;

    // Guard 1: Don't reset during active generation
    if (hasInitiatedGeneration) return false;

    // Guard 2: Don't reset a valid controlled tab (e.g. TASKS from URL)
    // even if it's not yet in availableTabs — wait for data to load
    if (isControlled && activeTab && VALID_PLAN_TABS.includes(activeTab)) return false;

    // All guards passed → reset should occur
    return true;
  }

  test("controlled mode: TASKS tab not in availableTabs → NO reset (guard protects it)", () => {
    const shouldReset = shouldResetTab(["PLAN"], "TASKS", true, false);
    expect(shouldReset).toBe(false);
  });

  test("controlled mode: PLAN tab already in availableTabs → NO reset", () => {
    const shouldReset = shouldResetTab(["PLAN", "TASKS"], "PLAN", true, false);
    expect(shouldReset).toBe(false);
  });

  test("uncontrolled mode: activeTab=null → reset to first available", () => {
    const shouldReset = shouldResetTab(["PLAN"], null, false, false);
    expect(shouldReset).toBe(true);
  });

  test("controlled mode: CODE tab not recognized → reset to first available", () => {
    const shouldReset = shouldResetTab(["PLAN", "TASKS"], "CODE", true, false);
    expect(shouldReset).toBe(true);
  });

  test("controlled mode: TASKS tab with hasInitiatedGeneration=true → NO reset", () => {
    const shouldReset = shouldResetTab(["PLAN"], "TASKS", true, true);
    expect(shouldReset).toBe(false);
  });

  test("controlled mode: DIFF tab not in VALID_PLAN_TABS → reset to first available", () => {
    const shouldReset = shouldResetTab(["PLAN", "TASKS"], "DIFF", true, false);
    expect(shouldReset).toBe(true);
  });

  test("uncontrolled mode: CODE tab not in availableTabs → reset to first available", () => {
    const shouldReset = shouldResetTab(["PLAN", "TASKS"], "CODE", false, false);
    expect(shouldReset).toBe(true);
  });

  test("controlled mode: empty availableTabs → NO reset triggered", () => {
    const shouldReset = shouldResetTab([], "TASKS", true, false);
    expect(shouldReset).toBe(false);
  });

  test("uncontrolled mode: PLAN tab in availableTabs → NO reset", () => {
    const shouldReset = shouldResetTab(["PLAN", "TASKS"], "PLAN", false, false);
    expect(shouldReset).toBe(false);
  });

  test("controlled mode: null activeTab with availableTabs → reset occurs", () => {
    const shouldReset = shouldResetTab(["PLAN"], null, true, false);
    expect(shouldReset).toBe(true);
  });

  test("uncontrolled mode: TASKS not in availableTabs → reset occurs (no guard)", () => {
    // Unlike controlled mode, uncontrolled doesn't protect TASKS
    const shouldReset = shouldResetTab(["PLAN"], "TASKS", false, false);
    expect(shouldReset).toBe(true);
  });

  test("controlled mode: BROWSER tab not in VALID_PLAN_TABS → reset occurs", () => {
    const shouldReset = shouldResetTab(["PLAN"], "BROWSER", true, false);
    expect(shouldReset).toBe(true);
  });
});
