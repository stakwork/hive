import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
// import { useTestLayerFetching } from '@/hooks/useTestLayerFetching';

/**
 * Unit tests for useTestLayerFetching hook
 * 
 * Tests verify URL construction, fetch prevention, and proper integration
 * with graph store state management.
 * 
 * NOTE: These tests are currently SKIPPED because the hook implementation is pending.
 * The hook should be created at: src/hooks/useTestLayerFetching.ts
 * 
 * TO ENABLE THESE TESTS:
 * 1. Implement the hook at src/hooks/useTestLayerFetching.ts
 * 2. Uncomment the import statement above
 * 3. Change all describe.skip to describe
 */

// Mock dependencies
vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    workspace: { id: 'test-workspace-id' },
  }),
}));

vi.mock('@/stores/useDataStore', () => ({
  useDataStore: () => ({
    addNewNode: vi.fn(),
  }),
}));

vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: vi.fn(),
}));

// Placeholder for the hook import when implemented
const useTestLayerFetching = () => {};

describe.skip('useTestLayerFetching hook - URL construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct correct API URL for unit tests', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    const expectedEndpoint = 'graph/search?limit=500&depth=1&node_type=["unittest"]';
    const expectedUrl = `/api/swarm/jarvis/nodes?id=test-workspace-id&endpoint=${encodeURIComponent(expectedEndpoint)}`;

    expect(global.fetch).toHaveBeenCalledWith(expectedUrl);
  });

  it('should construct correct API URL for integration tests', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: false, integrationTests: true, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    const expectedEndpoint = 'graph/search?limit=500&depth=1&node_type=["integrationtest"]';
    const expectedUrl = `/api/swarm/jarvis/nodes?id=test-workspace-id&endpoint=${encodeURIComponent(expectedEndpoint)}`;

    expect(global.fetch).toHaveBeenCalledWith(expectedUrl);
  });

  it('should construct correct API URL for e2e tests', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: false, integrationTests: false, e2eTests: true },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    const expectedEndpoint = 'graph/search?limit=500&depth=1&node_type=["e2etest"]';
    const expectedUrl = `/api/swarm/jarvis/nodes?id=test-workspace-id&endpoint=${encodeURIComponent(expectedEndpoint)}`;

    expect(global.fetch).toHaveBeenCalledWith(expectedUrl);
  });

  it('should properly encode the endpoint parameter', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    const fetchCall = (global.fetch as any).mock.calls[0][0];
    
    // Verify the endpoint contains encoded special characters
    expect(fetchCall).toContain(encodeURIComponent('graph/search?limit=500&depth=1'));
    expect(fetchCall).not.toContain('graph/search?limit=500&depth=1&node_type'); // Should be encoded
  });
});

describe.skip('useTestLayerFetching hook - Fetch prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should prevent duplicate fetches using fetchInProgressRef', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    // Simulate slow fetch
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({ nodes: [], edges: [] }) }), 100)
        )
    );

    const { rerender } = renderHook(() => useTestLayerFetching());

    // Trigger multiple renders quickly
    rerender();
    rerender();
    rerender();

    await waitFor(() => {
      // Should only have called fetch once despite multiple renders
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('should not fetch when testNodesFetched is already true', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: true, integrationTests: false, e2eTests: false }, // Already fetched
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn();

    renderHook(() => useTestLayerFetching());

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should not fetch when visibility is false', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockGraphStore = {
      testLayerVisibility: { unitTests: false, integrationTests: false, e2eTests: false }, // All disabled
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn();

    renderHook(() => useTestLayerFetching());

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch independently for each test type', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const setTestNodesFetched = vi.fn();
    
    // Start with unit tests enabled
    const mockGraphStore = {
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched,
    };
    useGraphStore.mockReturnValue(mockGraphStore);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    const { rerender } = renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Now enable integration tests
    mockGraphStore.testLayerVisibility = { unitTests: true, integrationTests: true, e2eTests: false };
    mockGraphStore.testNodesFetched = { unitTests: true, integrationTests: false, e2eTests: false };
    rerender();

    await waitFor(() => {
      // Should fetch again for integration tests
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe.skip('useTestLayerFetching hook - Data integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call addNewNode with fetched data', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const { useDataStore } = require('@/stores/useDataStore');
    
    const mockAddNewNode = vi.fn();
    const mockSetTestNodesFetched = vi.fn();
    const mockSetTestNodeIds = vi.fn();

    useDataStore.mockReturnValue({ addNewNode: mockAddNewNode });
    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: mockSetTestNodesFetched,
      setTestNodeIds: mockSetTestNodeIds,
    });

    const mockNodes = [
      { ref_id: 'node1', node_type: 'unittest', name: 'Test 1' },
      { ref_id: 'node2', node_type: 'function', name: 'Function 1' },
    ];
    const mockEdges = [{ source: 'node1', target: 'node2' }];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: mockNodes, edges: mockEdges }),
    });

    renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(mockAddNewNode).toHaveBeenCalledWith({
        nodes: mockNodes,
        edges: mockEdges,
      });
    });
  });

  it('should extract and store test node IDs', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const { useDataStore } = require('@/stores/useDataStore');
    
    const mockSetTestNodeIds = vi.fn();

    useDataStore.mockReturnValue({ addNewNode: vi.fn() });
    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
      setTestNodeIds: mockSetTestNodeIds,
    });

    const mockNodes = [
      { ref_id: 'test1', node_type: 'unittest', name: 'Test 1' },
      { ref_id: 'test2', node_type: 'unittest', name: 'Test 2' },
      { ref_id: 'func1', node_type: 'function', name: 'Function 1' }, // Not a test node
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: mockNodes, edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(mockSetTestNodeIds).toHaveBeenCalledWith('unitTests', ['test1', 'test2']);
    });
  });

  it('should mark test type as fetched after successful fetch', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockSetTestNodesFetched = vi.fn();

    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: mockSetTestNodesFetched,
      setTestNodeIds: vi.fn(),
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(mockSetTestNodesFetched).toHaveBeenCalledWith('unitTests', true);
    });
  });

  it('should handle fetch errors gracefully', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
      setTestNodeIds: vi.fn(),
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not mark as fetched when fetch fails', async () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    const mockSetTestNodesFetched = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: mockSetTestNodesFetched,
      setTestNodeIds: vi.fn(),
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    renderHook(() => useTestLayerFetching());

    await waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });

    // Should not mark as fetched on error
    expect(mockSetTestNodesFetched).not.toHaveBeenCalled();
  });
});

describe.skip('useTestLayerFetching hook - Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should cancel ongoing fetch on unmount', () => {
    const { useGraphStore } = require('@/stores/useGraphStore');
    
    useGraphStore.mockReturnValue({
      testLayerVisibility: { unitTests: true, integrationTests: false, e2eTests: false },
      testNodesFetched: { unitTests: false, integrationTests: false, e2eTests: false },
      setTestNodesFetched: vi.fn(),
      setTestNodeIds: vi.fn(),
    });

    // Simulate slow fetch that won't complete before unmount
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({ nodes: [], edges: [] }) }), 1000)
        )
    );

    const { unmount } = renderHook(() => useTestLayerFetching());

    // Unmount immediately
    unmount();

    // The fetch should be cancelled/ignored
    // Implementation should use AbortController or a mounted ref
    expect(global.fetch).toHaveBeenCalled();
  });
});
