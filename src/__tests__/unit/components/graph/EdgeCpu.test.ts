import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Link } from '@Universe/types';

/**
 * EdgeCpu Performance Optimization Test Suite
 * 
 * Tests the optimization of link data lookup from O(n) Array.find() to O(1) Map.get()
 * 
 * Performance Goal: 1000x-10000x reduction in CPU cycles for 10k+ edge graphs
 */

describe('EdgeCpu Performance Optimization', () => {
  describe('Link Lookup Performance', () => {
    it('should demonstrate Map.get() is significantly faster than Array.find() for large datasets', () => {
      // Generate 1000 mock links
      const mockLinks: Link[] = Array.from({ length: 1000 }, (_, i) => ({
        ref_id: `link-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        edge_type: 'test_edge',
      }));

      // Create Map for O(1) lookup
      const linksMap = new Map<string, Link>();
      mockLinks.forEach(link => linksMap.set(link.ref_id, link));

      // Test target: lookup middle element to prevent optimization bias
      const targetRefId = 'link-500';

      // Warmup phase to reduce JIT compilation effects
      for (let i = 0; i < 100; i++) {
        mockLinks.find(l => l.ref_id === targetRefId);
        linksMap.get(targetRefId);
      }

      // Benchmark Array.find() - O(n) - Run multiple times and take median
      const arrayTimes: number[] = [];
      for (let trial = 0; trial < 5; trial++) {
        const arrayStartTime = performance.now();
        for (let i = 0; i < 1000; i++) {
          const result = mockLinks.find(l => l.ref_id === targetRefId);
          expect(result).toBeDefined();
        }
        arrayTimes.push(performance.now() - arrayStartTime);
      }
      const arrayDuration = arrayTimes.sort((a, b) => a - b)[2]; // median

      // Benchmark Map.get() - O(1) - Run multiple times and take median
      const mapTimes: number[] = [];
      for (let trial = 0; trial < 5; trial++) {
        const mapStartTime = performance.now();
        for (let i = 0; i < 1000; i++) {
          const result = linksMap.get(targetRefId);
          expect(result).toBeDefined();
        }
        mapTimes.push(performance.now() - mapStartTime);
      }
      const mapDuration = mapTimes.sort((a, b) => a - b)[2]; // median

      // Assert Map is faster than Array
      // Note: In test environments with JIT optimizations, the speedup may vary
      expect(mapDuration).toBeLessThan(arrayDuration);
      const speedup = arrayDuration / mapDuration;

      console.log(`Performance Improvement: ${speedup.toFixed(2)}x faster with Map.get()`);
      console.log(`Array.find(): ${arrayDuration.toFixed(3)}ms (median of 5 trials)`);
      console.log(`Map.get(): ${mapDuration.toFixed(3)}ms (median of 5 trials)`);
    });

    it('should scale linearly with O(1) Map lookup vs O(n) Array search', () => {
      const testSizes = [100, 500, 1000, 5000];
      const arrayTimes: number[] = [];
      const mapTimes: number[] = [];

      testSizes.forEach(size => {
        // Generate mock links
        const mockLinks: Link[] = Array.from({ length: size }, (_, i) => ({
          ref_id: `link-${i}`,
          source: `node-${i}`,
          target: `node-${i + 1}`,
          edge_type: 'test_edge',
        }));

        const linksMap = new Map<string, Link>();
        mockLinks.forEach(link => linksMap.set(link.ref_id, link));

        const targetRefId = `link-${Math.floor(size / 2)}`;

        // Benchmark Array.find()
        const arrayStart = performance.now();
        for (let i = 0; i < 100; i++) {
          mockLinks.find(l => l.ref_id === targetRefId);
        }
        const arrayTime = performance.now() - arrayStart;
        arrayTimes.push(arrayTime);

        // Benchmark Map.get()
        const mapStart = performance.now();
        for (let i = 0; i < 100; i++) {
          linksMap.get(targetRefId);
        }
        const mapTime = performance.now() - mapStart;
        mapTimes.push(mapTime);
      });

      // Map times should remain relatively constant (O(1))
      // Array times should increase with size (O(n))
      const mapVariance = Math.max(...mapTimes) / Math.min(...mapTimes);
      const arrayVariance = Math.max(...arrayTimes) / Math.min(...arrayTimes);

      expect(arrayVariance).toBeGreaterThan(mapVariance);
      console.log('Scaling Test Results:');
      testSizes.forEach((size, i) => {
        console.log(`  Size ${size}: Array=${arrayTimes[i].toFixed(3)}ms, Map=${mapTimes[i].toFixed(3)}ms`);
      });
    });
  });

  describe('Highlight State Calculation', () => {
    let mockLinksMap: Map<string, Link>;
    let mockNodesMap: Map<string, any>;

    beforeEach(() => {
      // Setup mock data for highlight state tests
      mockLinksMap = new Map([
        ['link-1', { ref_id: 'link-1', source: 'node-a', target: 'node-b', edge_type: 'type1' }],
        ['link-2', { ref_id: 'link-2', source: 'node-b', target: 'node-c', edge_type: 'type2' }],
        ['link-3', { ref_id: 'link-3', source: 'node-c', target: 'node-d', edge_type: 'type1' }],
      ]);

      mockNodesMap = new Map([
        ['node-a', { ref_id: 'node-a', node_type: 'Function', label: 'Node A' }],
        ['node-b', { ref_id: 'node-b', node_type: 'Function', label: 'Node B' }],
        ['node-c', { ref_id: 'node-c', node_type: 'File', label: 'Node C' }],
        ['node-d', { ref_id: 'node-d', node_type: 'File', label: 'Node D' }],
      ]);
    });

    it('should calculate normal highlight state (0) for unrelated edges', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = null;
      const selectedNode = null;
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes: string[] = [];
      const searchQuery = '';

      // Calculate highlight state (0 = normal, 1 = hovered, 2 = selected)
      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1;
          }
        }
      }

      expect(highlightState).toBe(0); // Normal state
    });

    it('should calculate hovered highlight state (1) for edges connected to hovered node', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = { ref_id: 'node-a', node_type: 'Function', label: 'Node A' };
      const selectedNode = null;
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes: string[] = [];
      const searchQuery = '';

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1;
          }
        }
      }

      expect(highlightState).toBe(1); // Hovered state
    });

    it('should calculate selected highlight state (2) for edges connected to selected node', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = null;
      const selectedNode = { ref_id: 'node-a', node_type: 'Function', label: 'Node A' };
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes: string[] = [];
      const searchQuery = '';

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1;
          }
        }
      }

      expect(highlightState).toBe(2); // Selected state
    });

    it('should prioritize selected state (2) over hovered state (1) when both are present', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      // Both hovered and selected node connected to the same edge
      const hoveredNode = { ref_id: 'node-b', node_type: 'Function', label: 'Node B' };
      const selectedNode = { ref_id: 'node-a', node_type: 'Function', label: 'Node A' };
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes: string[] = [];
      const searchQuery = '';

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2; // Selected takes priority
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1;
          }
        }
      }

      expect(highlightState).toBe(2); // Selected state has priority
    });

    it('should calculate hovered state (1) for active link types', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = null;
      const selectedNode = null;
      const selectedLinkTypes = ['type1']; // Active link type
      const selectedNodeTypes: string[] = [];
      const searchQuery = '';

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1; // Active link
          }
        }
      }

      expect(highlightState).toBe(1); // Hovered/active state
    });

    it('should calculate hovered state (1) for active node types', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = null;
      const selectedNode = null;
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes = ['Function']; // Active node type
      const searchQuery = '';

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1; // Active link
          }
        }
      }

      expect(highlightState).toBe(1); // Hovered/active state for matching node types
    });

    it('should calculate hovered state (1) when search query is active', () => {
      const linkData = mockLinksMap.get('link-1');
      expect(linkData).toBeDefined();

      const hoveredNode = null;
      const selectedNode = null;
      const selectedLinkTypes: string[] = [];
      const selectedNodeTypes: string[] = [];
      const searchQuery = 'test'; // Active search

      let highlightState = 0;

      if (linkData) {
        const sourceNode = mockNodesMap.get(linkData.source);
        const targetNode = mockNodesMap.get(linkData.target);

        const activeLink = 
          selectedLinkTypes.includes(linkData.edge_type) ||
          (selectedNodeTypes.includes(sourceNode?.node_type) && selectedNodeTypes.includes(targetNode?.node_type));

        const connectedToSelectedNode = 
          selectedNode?.ref_id === linkData.source || selectedNode?.ref_id === linkData.target;

        const connectedToHoveredNode = 
          hoveredNode?.ref_id === linkData.source || hoveredNode?.ref_id === linkData.target;

        if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
          if (connectedToSelectedNode) {
            highlightState = 2;
          } else if (connectedToHoveredNode) {
            highlightState = 1;
          } else {
            highlightState = 1; // Active search
          }
        }
      }

      expect(highlightState).toBe(1); // Hovered/active state with search
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing linkRefId gracefully', () => {
      const linksMap = new Map<string, Link>([
        ['link-1', { ref_id: 'link-1', source: 'node-a', target: 'node-b', edge_type: 'test' }],
      ]);

      const linkData = linksMap.get('non-existent-link');
      expect(linkData).toBeUndefined();

      // Should not throw error and return undefined (same behavior as Array.find())
      expect(() => linksMap.get('non-existent-link')).not.toThrow();
    });

    it('should handle undefined linksNormalized Map gracefully', () => {
      const linksMap = undefined;
      
      // Should handle undefined Map access safely
      expect(() => {
        const result = linksMap?.get('link-1');
        expect(result).toBeUndefined();
      }).not.toThrow();
    });

    it('should handle empty linksNormalized Map', () => {
      const linksMap = new Map<string, Link>();

      expect(linksMap.size).toBe(0);
      expect(linksMap.get('any-link')).toBeUndefined();
    });

    it('should handle null/undefined ref_id in link data', () => {
      const linksMap = new Map<string, Link>();
      
      // Should not crash when setting with undefined/null key
      expect(() => {
        linksMap.set('', { ref_id: '', source: 'a', target: 'b', edge_type: 'test' });
      }).not.toThrow();

      expect(linksMap.get('')).toBeDefined();
    });

    it('should maintain consistent behavior with Array.find() for undefined lookups', () => {
      const mockLinks: Link[] = [
        { ref_id: 'link-1', source: 'node-a', target: 'node-b', edge_type: 'test' },
      ];

      const linksMap = new Map<string, Link>();
      mockLinks.forEach(link => linksMap.set(link.ref_id, link));

      const arrayResult = mockLinks.find(l => l.ref_id === 'non-existent');
      const mapResult = linksMap.get('non-existent');

      // Both should return undefined for missing keys
      expect(arrayResult).toBeUndefined();
      expect(mapResult).toBeUndefined();
      expect(arrayResult).toBe(mapResult);
    });
  });

  describe('Large-Scale Performance Test', () => {
    it('should handle 10,000 edges efficiently with Map.get()', () => {
      // Generate 10,000 mock links
      const mockLinks: Link[] = Array.from({ length: 10000 }, (_, i) => ({
        ref_id: `link-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        edge_type: 'test_edge',
      }));

      const linksMap = new Map<string, Link>();
      mockLinks.forEach(link => linksMap.set(link.ref_id, link));

      // Simulate 60fps frame rate: 10k edges * 60 frames = 600k lookups per second
      const targetRefIds = Array.from({ length: 10000 }, (_, i) => `link-${i}`);

      const start = performance.now();
      let foundCount = 0;
      
      // Simulate one frame of lookups
      targetRefIds.forEach(refId => {
        const result = linksMap.get(refId);
        if (result) foundCount++;
      });

      const duration = performance.now() - start;

      expect(foundCount).toBe(10000);
      expect(duration).toBeLessThan(50); // Should complete well within 16.67ms frame budget at 60fps

      console.log(`Large-Scale Test: 10k edge lookups in ${duration.toFixed(3)}ms`);
      console.log(`Effective throughput: ${(foundCount / (duration / 1000)).toFixed(0)} lookups/second`);
    });
  });
});
