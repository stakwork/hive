import { describe, test, expect, beforeEach } from 'vitest';
import { useGraphStore } from '@/stores/useGraphStore';

describe('useGraphStore', () => {
  beforeEach(() => {
    // Reset store state before each test to default values
    const state = useGraphStore.getState();
    state.setIsFilterLoading(false);
    state.setActiveFilterTab('all');
  });

  describe('isFilterLoading state', () => {
    test('should initialize isFilterLoading to false', () => {
      const state = useGraphStore.getState();
      expect(state.isFilterLoading).toBe(false);
    });

    test('should update isFilterLoading to true when setIsFilterLoading is called with true', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      setIsFilterLoading(true);
      
      const state = useGraphStore.getState();
      expect(state.isFilterLoading).toBe(true);
    });

    test('should update isFilterLoading to false when setIsFilterLoading is called with false', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      
      // First set to true
      setIsFilterLoading(true);
      expect(useGraphStore.getState().isFilterLoading).toBe(true);

      // Then set back to false
      setIsFilterLoading(false);
      expect(useGraphStore.getState().isFilterLoading).toBe(false);
    });

    test('should allow toggling isFilterLoading multiple times', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      
      // Initial state
      expect(useGraphStore.getState().isFilterLoading).toBe(false);

      // Toggle sequence: false -> true -> false -> true
      setIsFilterLoading(true);
      expect(useGraphStore.getState().isFilterLoading).toBe(true);

      setIsFilterLoading(false);
      expect(useGraphStore.getState().isFilterLoading).toBe(false);

      setIsFilterLoading(true);
      expect(useGraphStore.getState().isFilterLoading).toBe(true);
    });

    test('should maintain isFilterLoading state independently of other store properties', () => {
      const { setActiveFilterTab, setIsFilterLoading } = useGraphStore.getState();
      
      // Set some other store properties
      setActiveFilterTab('code');
      setIsFilterLoading(true);

      // Verify both states are maintained correctly
      const state1 = useGraphStore.getState();
      expect(state1.activeFilterTab).toBe('code');
      expect(state1.isFilterLoading).toBe(true);

      // Change filter tab but keep loading state
      setActiveFilterTab('tasks');
      const state2 = useGraphStore.getState();
      expect(state2.activeFilterTab).toBe('tasks');
      expect(state2.isFilterLoading).toBe(true);
    });

    test('should handle rapid state changes', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      
      // Simulate rapid loading state changes (like quick filter switches with AbortController)
      for (let i = 0; i < 10; i++) {
        setIsFilterLoading(true);
        expect(useGraphStore.getState().isFilterLoading).toBe(true);
        
        setIsFilterLoading(false);
        expect(useGraphStore.getState().isFilterLoading).toBe(false);
      }
    });
  });

  describe('setIsFilterLoading function', () => {
    test('should be a function', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      expect(typeof setIsFilterLoading).toBe('function');
    });

    test('should accept boolean parameter', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      
      // Should not throw
      expect(() => setIsFilterLoading(true)).not.toThrow();
      expect(() => setIsFilterLoading(false)).not.toThrow();
    });

    test('should return void', () => {
      const { setIsFilterLoading } = useGraphStore.getState();
      const result = setIsFilterLoading(true);
      expect(result).toBeUndefined();
    });
  });
});
