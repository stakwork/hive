import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTestLayerFetching } from '@/hooks/useTestLayerFetching';
import * as workspaceHook from '@/hooks/useWorkspace';
import * as dataStore from '@/stores/useDataStore';
import * as graphStore from '@/stores/useGraphStore';

// Mock hooks and stores
vi.mock('@/hooks/useWorkspace');
vi.mock('@/stores/useDataStore');
vi.mock('@/stores/useGraphStore');

describe('useTestLayerFetching', () => {
  const mockWorkspaceId = 'test-workspace-123';
  const mockAddNewNode = vi.fn();
  const mockSetTestNodesFetched = vi.fn();

  const mockTestLayerVisibility = {
    unitTests: false,
    integrationTests: false,
    e2eTests: false,
  };

  const mockTestNodesFetched = {
    unitTests: false,
    integrationTests: false,
    e2eTests: false,
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock fetch globally
    global.fetch = vi.fn();

    // Mock useWorkspace
    vi.spyOn(workspaceHook, 'useWorkspace').mockReturnValue({
      id: mockWorkspaceId,
      slug: 'test-workspace',
    } as any);

    // Mock useDataStore
    vi.spyOn(dataStore, 'useDataStore').mockImplementation((selector: any) => {
      const state = { addNewNode: mockAddNewNode };
      return selector(state);
    });

    // Mock useGraphStore with default values
    vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
      const state = {
        testLayerVisibility: mockTestLayerVisibility,
        testNodesFetched: mockTestNodesFetched,
        setTestNodesFetched: mockSetTestNodesFetched,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Functionality', () => {
    test('should not fetch when no test layers are visible', () => {
      renderHook(() => useTestLayerFetching());

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockAddNewNode).not.toHaveBeenCalled();
      expect(mockSetTestNodesFetched).not.toHaveBeenCalled();
    });

    test('should not fetch when workspaceId is undefined', () => {
      vi.spyOn(workspaceHook, 'useWorkspace').mockReturnValue({
        id: undefined,
      } as any);

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should fetch unittest nodes when unitTests visibility is enabled', async () => {
      const mockNodes = [
        { ref_id: 'test-1', name: 'Test 1', node_type: 'unittest' },
        { ref_id: 'test-2', name: 'Test 2', node_type: 'unittest' },
      ];
      const mockEdges = [
        { ref_id: 'edge-1', source: 'test-1', target: 'function-1', edge_type: 'tests' },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const fetchCall = (global.fetch as any).mock.calls[0][0];
      expect(fetchCall).toContain(`id=${mockWorkspaceId}`);
      expect(fetchCall).toContain(encodeURIComponent('graph/search?limit=500&depth=1&node_type=["unittest"]'));

      await waitFor(() => {
        expect(mockAddNewNode).toHaveBeenCalledTimes(1);
      });

      expect(mockAddNewNode).toHaveBeenCalledWith({
        nodes: mockNodes.map(node => ({
          ...node,
          x: 0,
          y: 0,
          z: 0,
          edge_count: 0,
        })),
        edges: mockEdges,
      });

      await waitFor(() => {
        expect(mockSetTestNodesFetched).toHaveBeenCalledWith('unitTests', true);
      });
    });
  });

  describe('URL Construction', () => {
    test('should construct correct URL for unittest nodes', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({ success: true, data: { nodes: [], edges: [] } }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain(`/api/swarm/jarvis/nodes?id=${mockWorkspaceId}`);
      expect(fetchUrl).toContain(encodeURIComponent('graph/search?limit=500&depth=1&node_type=["unittest"]'));
    });

    test('should construct correct URL for integrationtest nodes', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({ success: true, data: { nodes: [], edges: [] } }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: false, integrationTests: true, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain(encodeURIComponent('graph/search?limit=500&depth=1&node_type=["integrationtest"]'));
    });

    test('should construct correct URL for e2etest nodes', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({ success: true, data: { nodes: [], edges: [] } }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: false, integrationTests: false, e2eTests: true },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain(encodeURIComponent('graph/search?limit=500&depth=1&node_type=["e2etest"]'));
    });
  });

  describe('Duplicate Prevention', () => {
    test('should not refetch when testNodesFetched is already true', async () => {
      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: true, integrationTests: false, e2eTests: false }, // Already fetched
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      // Wait a bit to ensure no fetch happens
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockAddNewNode).not.toHaveBeenCalled();
    });

    test('should fetch independently for each test type', async () => {
      const mockNodesUnit = [{ ref_id: 'unit-1', name: 'Unit Test', node_type: 'unittest' }];
      const mockNodesIntegration = [{ ref_id: 'int-1', name: 'Integration Test', node_type: 'integrationtest' }];

      (global.fetch as any)
        .mockResolvedValueOnce({
          json: async () => ({ success: true, data: { nodes: mockNodesUnit, edges: [] } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, data: { nodes: mockNodesIntegration, edges: [] } }),
        });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: true, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(mockSetTestNodesFetched).toHaveBeenCalledWith('unitTests', true);
        expect(mockSetTestNodesFetched).toHaveBeenCalledWith('integrationTests', true);
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle fetch errors gracefully without blocking', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to fetch unitTests test nodes'),
          expect.any(Error)
        );
      });

      expect(mockAddNewNode).not.toHaveBeenCalled();
      expect(mockSetTestNodesFetched).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test('should not log error for AbortError', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValueOnce(abortError);

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      const { unmount } = renderHook(() => useTestLayerFetching());
      
      // Unmount immediately to trigger abort
      unmount();

      await waitFor(() => {
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });

    test('should handle API response without nodes gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({ success: true, data: {} }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Should not call addNewNode or setTestNodesFetched when no nodes returned
      expect(mockAddNewNode).not.toHaveBeenCalled();
      expect(mockSetTestNodesFetched).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    test('should abort ongoing fetch on unmount', async () => {
      let abortSignal: AbortSignal | null | undefined;

      (global.fetch as any).mockImplementation((url: string, options: RequestInit) => {
        abortSignal = options.signal || null;
        return new Promise(() => {}); // Never resolve to simulate slow request
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      const { unmount } = renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      expect(abortSignal).toBeDefined();
      expect(abortSignal?.aborted).toBe(false);

      unmount();

      expect(abortSignal?.aborted).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    test('should call addNewNode with correct data structure after successful fetch', async () => {
      const mockNodes = [
        { ref_id: 'test-1', name: 'Test 1', node_type: 'unittest', x: 10, y: 20, z: 30, edge_count: 2 },
        { ref_id: 'test-2', name: 'Test 2', node_type: 'unittest' }, // Missing coordinates
      ];
      const mockEdges = [
        { ref_id: 'edge-1', source: 'test-1', target: 'func-1', edge_type: 'tests' },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(mockAddNewNode).toHaveBeenCalledWith({
          nodes: [
            { ref_id: 'test-1', name: 'Test 1', node_type: 'unittest', x: 10, y: 20, z: 30, edge_count: 2 },
            { ref_id: 'test-2', name: 'Test 2', node_type: 'unittest', x: 0, y: 0, z: 0, edge_count: 0 },
          ],
          edges: mockEdges,
        });
      });
    });

    test('should set correct fetched status after successful fetch', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { nodes: [{ ref_id: 'test-1', name: 'Test', node_type: 'unittest' }], edges: [] },
        }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(mockSetTestNodesFetched).toHaveBeenCalledWith('unitTests', true);
      });

      expect(mockSetTestNodesFetched).not.toHaveBeenCalledWith('integrationTests', expect.anything());
      expect(mockSetTestNodesFetched).not.toHaveBeenCalledWith('e2eTests', expect.anything());
    });

    test('should handle empty edges array in API response', async () => {
      const mockNodes = [{ ref_id: 'test-1', name: 'Test', node_type: 'unittest' }];

      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { nodes: mockNodes }, // No edges field
        }),
      });

      vi.spyOn(graphStore, 'useGraphStore').mockImplementation((selector: any) => {
        const state = {
          testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
          testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
          setTestNodesFetched: mockSetTestNodesFetched,
        };
        return selector(state);
      });

      renderHook(() => useTestLayerFetching());

      await waitFor(() => {
        expect(mockAddNewNode).toHaveBeenCalledWith(
          expect.objectContaining({
            nodes: expect.any(Array),
            edges: [],
          })
        );
      });
    });
  });
});
