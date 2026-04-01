import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef, useState } from "react";

/**
 * Unit tests for the fitView auto-fit behavior in workflow component
 * Tests the logic that determines when fitView should be called on initial load
 */

describe("Workflow fitView auto-fit logic", () => {
  let localStorageMock: Record<string, string>;
  let fitViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      length: 0,
      key: vi.fn(),
    } as Storage;

    // Mock fitView
    fitViewMock = vi.fn();

    // Mock setTimeout
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /**
   * Helper hook that simulates the fitView useEffect logic from the workflow component
   */
  const useFitViewLogic = ({
    projectId,
    workflowData,
    workflowId,
    reactFlowInstance,
    nodes,
  }: {
    projectId?: string;
    workflowData?: any;
    workflowId: string;
    reactFlowInstance: any;
    nodes: any[];
  }) => {
    const hasInitialFitViewRef = useRef(false);
    const [fitViewCalled, setFitViewCalled] = useState(false);

    useEffect(() => {
      const isEditorMode = !!workflowData && !projectId;
      const hasSavedPosition = isEditorMode && !!localStorage.getItem(`position_${workflowId}`);

      if (
        (projectId || (isEditorMode && !hasSavedPosition)) &&
        reactFlowInstance &&
        nodes.length > 0 &&
        !hasInitialFitViewRef.current
      ) {
        hasInitialFitViewRef.current = true;

        setTimeout(() => {
          reactFlowInstance.fitView({
            padding: 0.2,
            duration: 300,
          });
          setFitViewCalled(true);
        }, 100);
      }
    }, [projectId, workflowData, workflowId, reactFlowInstance, nodes.length]);

    return { fitViewCalled, hasInitialFitViewRef };
  };

  describe("Editor mode (workflowData present, no projectId)", () => {
    it("should call fitView when no saved position exists", () => {
      const workflowId = "test-workflow-123";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }, { id: "node2" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      const { result } = renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      // Advance timers to trigger setTimeout
      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).toHaveBeenCalledTimes(1);
      expect(fitViewMock).toHaveBeenCalledWith({
        padding: 0.2,
        duration: 300,
      });
      expect(result.current.hasInitialFitViewRef.current).toBe(true);
    });

    it("should NOT call fitView when saved position exists in localStorage", () => {
      const workflowId = "test-workflow-456";
      const savedPosition = JSON.stringify({ x: 100, y: 200, zoom: 0.8 });
      localStorageMock[`position_${workflowId}`] = savedPosition;

      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }, { id: "node2" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      // Advance timers
      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).not.toHaveBeenCalled();
    });

    it("should call fitView when projectId is undefined (not empty string)", () => {
      const workflowId = "test-workflow-789";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: undefined,
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Project mode (projectId present)", () => {
    it("should call fitView when projectId is truthy", () => {
      const workflowId = "project-workflow-123";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }, { id: "node2" }, { id: "node3" }];

      renderHook(() =>
        useFitViewLogic({
          projectId: "project-abc-123",
          workflowData: undefined,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).toHaveBeenCalledTimes(1);
      expect(fitViewMock).toHaveBeenCalledWith({
        padding: 0.2,
        duration: 300,
      });
    });

    it("should call fitView even when localStorage has a saved position (project mode ignores saved positions)", () => {
      const workflowId = "project-workflow-456";
      const savedPosition = JSON.stringify({ x: 50, y: 75, zoom: 1.2 });
      localStorageMock[`position_${workflowId}`] = savedPosition;

      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];

      renderHook(() =>
        useFitViewLogic({
          projectId: "project-xyz-789",
          workflowData: undefined,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      // Project mode should always call fitView, ignoring saved positions
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Empty workflows (no nodes)", () => {
    it("should NOT call fitView when nodes array is empty in editor mode", () => {
      const workflowId = "empty-workflow-123";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: [],
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).not.toHaveBeenCalled();
    });

    it("should NOT call fitView when nodes array is empty in project mode", () => {
      const workflowId = "empty-project-workflow";
      const mockReactFlowInstance = { fitView: fitViewMock };

      renderHook(() =>
        useFitViewLogic({
          projectId: "project-123",
          workflowData: undefined,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: [],
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).not.toHaveBeenCalled();
    });
  });

  describe("ReactFlow instance availability", () => {
    it("should NOT call fitView when reactFlowInstance is null", () => {
      const workflowId = "test-workflow-null-instance";
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: null,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).not.toHaveBeenCalled();
    });

    it("should NOT call fitView when reactFlowInstance is undefined", () => {
      const workflowId = "test-workflow-undefined-instance";
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: undefined,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).not.toHaveBeenCalled();
    });
  });

  describe("hasInitialFitViewRef guard", () => {
    it("should only call fitView once even when dependencies change", () => {
      const workflowId = "test-workflow-rerender";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockWorkflowData = { transitions: [], connections: [] };

      const { rerender } = renderHook(
        ({ nodes }) =>
          useFitViewLogic({
            projectId: "",
            workflowData: mockWorkflowData,
            workflowId,
            reactFlowInstance: mockReactFlowInstance,
            nodes,
          }),
        {
          initialProps: { nodes: [{ id: "node1" }] },
        },
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(fitViewMock).toHaveBeenCalledTimes(1);

      // Rerender with more nodes
      rerender({ nodes: [{ id: "node1" }, { id: "node2" }] });
      act(() => { vi.advanceTimersByTime(100); });

      // Should still only be called once due to hasInitialFitViewRef guard
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle workflowData being null", () => {
      const workflowId = "test-workflow-null-data";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: null,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      // workflowData is null, so isEditorMode is false, fitView should NOT be called
      expect(fitViewMock).not.toHaveBeenCalled();
    });

    it("should handle both projectId and workflowData being present (projectId takes precedence)", () => {
      const workflowId = "test-workflow-both";
      const savedPosition = JSON.stringify({ x: 100, y: 200, zoom: 0.8 });
      localStorageMock[`position_${workflowId}`] = savedPosition;

      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "project-123",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      // When both are present, projectId path is taken (not editor mode)
      // So fitView should be called regardless of saved position
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });

    it("should handle empty string workflowId", () => {
      const workflowId = "";
      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      // Should still work with empty workflowId (though not a realistic scenario)
      // No saved position will be found for empty key
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("localStorage key format", () => {
    it("should check for saved position with correct key format", () => {
      const workflowId = "my-workflow-id";
      const expectedKey = `position_${workflowId}`;
      const savedPosition = JSON.stringify({ x: 50, y: 100, zoom: 1 });
      localStorageMock[expectedKey] = savedPosition;

      const mockReactFlowInstance = { fitView: fitViewMock };
      const mockNodes = [{ id: "node1" }];
      const mockWorkflowData = { transitions: [], connections: [] };

      renderHook(() =>
        useFitViewLogic({
          projectId: "",
          workflowData: mockWorkflowData,
          workflowId,
          reactFlowInstance: mockReactFlowInstance,
          nodes: mockNodes,
        }),
      );

      act(() => { vi.advanceTimersByTime(100); });

      expect(localStorage.getItem).toHaveBeenCalledWith(expectedKey);
      expect(fitViewMock).not.toHaveBeenCalled();
    });
  });
});
