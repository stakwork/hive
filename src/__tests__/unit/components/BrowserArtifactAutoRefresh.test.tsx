/**
 * @vitest-environment jsdom
 *
 * Unit tests for the auto-refresh browser artifact feature:
 *   1. handleWorkflowStatusUpdate in page.tsx – increments browserRefreshTrigger
 *      on COMPLETED only in live mode, not agent mode.
 *   2. BrowserArtifactPanel – auto-refreshes iframe when browserRefreshTrigger
 *      increments, but not on initial mount with value 0.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useCallback, useEffect, useRef } from "react";
import { render } from "@testing-library/react";

globalThis.React = React;

// ---------------------------------------------------------------------------
// 1. handleWorkflowStatusUpdate logic (isolated hook simulation)
// ---------------------------------------------------------------------------

type WorkflowStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | "HALTED" | "FAILED";

function useWorkflowStatusLogic(initialTaskMode: "live" | "agent" | "workflow_editor") {
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>("PENDING");
  const [isChainVisible, setIsChainVisible] = useState(false);
  const [browserRefreshTrigger, setBrowserRefreshTrigger] = useState(0);
  const taskMode = initialTaskMode;

  const handleWorkflowStatusUpdate = useCallback(
    (update: { workflowStatus: WorkflowStatus }) => {
      setWorkflowStatus(update.workflowStatus);
      if (update.workflowStatus === "COMPLETED") {
        setIsChainVisible(false);
        if (taskMode !== "agent") {
          setBrowserRefreshTrigger((prev) => prev + 1);
        }
      }
    },
    [taskMode],
  );

  return { workflowStatus, isChainVisible, browserRefreshTrigger, handleWorkflowStatusUpdate };
}

describe("handleWorkflowStatusUpdate – browserRefreshTrigger logic", () => {
  it("increments browserRefreshTrigger when COMPLETED fires in live mode", () => {
    const { result } = renderHook(() => useWorkflowStatusLogic("live"));

    expect(result.current.browserRefreshTrigger).toBe(0);

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "COMPLETED" });
    });

    expect(result.current.workflowStatus).toBe("COMPLETED");
    expect(result.current.browserRefreshTrigger).toBe(1);
  });

  it("increments on each subsequent COMPLETED in live mode", () => {
    const { result } = renderHook(() => useWorkflowStatusLogic("live"));

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "COMPLETED" });
    });
    expect(result.current.browserRefreshTrigger).toBe(1);

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "IN_PROGRESS" });
    });
    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "COMPLETED" });
    });
    expect(result.current.browserRefreshTrigger).toBe(2);
  });

  it("does NOT increment browserRefreshTrigger when taskMode is agent", () => {
    const { result } = renderHook(() => useWorkflowStatusLogic("agent"));

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "COMPLETED" });
    });

    expect(result.current.workflowStatus).toBe("COMPLETED");
    expect(result.current.browserRefreshTrigger).toBe(0);
  });

  it("does NOT increment for non-COMPLETED statuses in live mode", () => {
    const { result } = renderHook(() => useWorkflowStatusLogic("live"));

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "IN_PROGRESS" });
    });
    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "ERROR" });
    });

    expect(result.current.browserRefreshTrigger).toBe(0);
  });

  it("increments in workflow_editor mode (non-agent live mode variant)", () => {
    const { result } = renderHook(() => useWorkflowStatusLogic("workflow_editor"));

    act(() => {
      result.current.handleWorkflowStatusUpdate({ workflowStatus: "COMPLETED" });
    });

    expect(result.current.browserRefreshTrigger).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. BrowserArtifactPanel auto-refresh logic (isolated hook simulation)
// ---------------------------------------------------------------------------

/** Mirrors the auto-refresh useEffect from BrowserArtifactPanel */
function useBrowserAutoRefresh(browserRefreshTrigger?: number) {
  const [refreshKey, setRefreshKey] = useState(0);
  const prevRefreshTriggerRef = useRef<number>(0);

  useEffect(() => {
    if (browserRefreshTrigger && browserRefreshTrigger > prevRefreshTriggerRef.current) {
      prevRefreshTriggerRef.current = browserRefreshTrigger;
      setRefreshKey((prev) => prev + 1);
    }
  }, [browserRefreshTrigger]);

  return { refreshKey };
}

describe("BrowserArtifactPanel – auto-refresh logic", () => {
  it("does NOT refresh on mount when browserRefreshTrigger is 0 (already-completed task)", () => {
    const { result } = renderHook(() => useBrowserAutoRefresh(0));
    expect(result.current.refreshKey).toBe(0);
  });

  it("does NOT refresh when browserRefreshTrigger is undefined", () => {
    const { result } = renderHook(() => useBrowserAutoRefresh(undefined));
    expect(result.current.refreshKey).toBe(0);
  });

  it("refreshes exactly once when browserRefreshTrigger increments to 1", () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger?: number }) => useBrowserAutoRefresh(trigger),
      { initialProps: { trigger: 0 } },
    );

    expect(result.current.refreshKey).toBe(0);

    act(() => {
      rerender({ trigger: 1 });
    });

    expect(result.current.refreshKey).toBe(1);
  });

  it("refreshes a second time when browserRefreshTrigger increments to 2", () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger?: number }) => useBrowserAutoRefresh(trigger),
      { initialProps: { trigger: 0 } },
    );

    act(() => {
      rerender({ trigger: 1 });
    });
    expect(result.current.refreshKey).toBe(1);

    act(() => {
      rerender({ trigger: 2 });
    });
    expect(result.current.refreshKey).toBe(2);
  });

  it("does NOT double-fire when re-rendered with the same trigger value", () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger?: number }) => useBrowserAutoRefresh(trigger),
      { initialProps: { trigger: 0 } },
    );

    act(() => {
      rerender({ trigger: 1 });
    });
    expect(result.current.refreshKey).toBe(1);

    // Re-render with same value – must not fire again
    act(() => {
      rerender({ trigger: 1 });
    });
    expect(result.current.refreshKey).toBe(1);
  });
});
