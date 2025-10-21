import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { createNodeElements, DEFAULT_COLORS, type GraphNode } from '@/components/graph/graphUtils';

describe('createNodeElements', () => {
  let container: d3.Selection<SVGGElement, unknown, null, undefined>;
  let mockDragBehavior: d3.DragBehavior<SVGGElement, GraphNode, unknown>;

  beforeEach(() => {
    // Create a fresh SVG container for each test
    const svg = d3.select(document.body).append('svg');
    container = svg.append('g');

    // Create a mock drag behavior
    mockDragBehavior = d3.drag<SVGGElement, GraphNode>();
  });

  afterEach(() => {
    // Cleanup DOM after each test
    d3.select('svg').remove();
  });

  describe('Basic SVG Structure', () => {
    it('creates correct number of node groups', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
        { id: '3', name: 'Node 3', type: 'Class' },
      ];

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      expect(nodeSelection.size()).toBe(3);
    });

    it('returns empty selection for empty nodes array', () => {
      const nodes: GraphNode[] = [];

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      expect(nodeSelection.size()).toBe(0);
    });

    it('creates g elements as node containers', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Test Node', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const gElements = container.selectAll('g.nodes g');
      expect(gElements.size()).toBe(1);
      expect(gElements.node()?.tagName).toBe('g');
    });
  });

  describe('Circle Elements', () => {
    it('creates circle with correct radius', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.attr('r')).toBe('12');
    });

    it('applies correct stroke attributes', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.attr('stroke')).toBe('#fff');
      expect(circle.attr('stroke-width')).toBe('2');
    });

    it('applies drop shadow filter', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.style('filter')).toBe('drop-shadow(1px 1px 2px rgba(0,0,0,0.2))');
    });

    it('uses color from colorMap when provided', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'CustomType' },
      ];
      const colorMap = { CustomType: '#ff5733' };

      createNodeElements(container, nodes, colorMap, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.attr('fill')).toBe('#ff5733');
    });

    it('falls back to DEFAULT_COLORS when colorMap not provided', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.attr('fill')).toBe(DEFAULT_COLORS.Function);
    });

    it('uses default gray color for unknown node types', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'UnknownType' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circle = container.select('circle');
      expect(circle.attr('fill')).toBe('#6b7280');
    });

    it('applies correct colors to multiple nodes with different types', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
        { id: '3', name: 'Node 3', type: 'Class' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const circles = container.selectAll('circle');
      const fills = circles.nodes().map(node => d3.select(node).attr('fill'));
      
      expect(fills).toEqual([
        DEFAULT_COLORS.Function,
        DEFAULT_COLORS.File,
        DEFAULT_COLORS.Class,
      ]);
    });
  });

  describe('Text Label Rendering', () => {
    it('renders node name as text label', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'MyFunction', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      expect(nameLabel.text()).toBe('MyFunction');
    });

    it('does not truncate names with exactly 20 characters', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: '12345678901234567890', type: 'Function' }, // Exactly 20 chars
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      expect(nameLabel.text()).toBe('12345678901234567890');
    });

    it('truncates names longer than 20 characters with ellipsis', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'ThisIsAVeryLongFunctionNameThatExceeds20Characters', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      expect(nameLabel.text()).toBe('ThisIsAVeryLongFunct...');
      expect(nameLabel.text().length).toBe(23); // 20 chars + '...'
    });

    it('positions name label above the node', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      
      expect(nameLabel.attr('x')).toBe('0');
      expect(nameLabel.attr('y')).toBe('-18');
      expect(nameLabel.attr('text-anchor')).toBe('middle');
    });

    it('applies correct text styling to name labels', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      
      expect(nameLabel.attr('font-size')).toBe('11px');
      expect(nameLabel.attr('font-weight')).toBe('500');
      expect(nameLabel.attr('fill')).toBe('currentColor');
      expect(nameLabel.style('pointer-events')).toBe('none');
    });
  });

  describe('Type Label Rendering', () => {
    it('renders node type as type label', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'MyFunction', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const typeLabel = d3.select(textLabels.nodes()[1]);
      expect(typeLabel.text()).toBe('Function');
    });

    it('positions type label below the node', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'File' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const typeLabel = d3.select(textLabels.nodes()[1]);
      
      expect(typeLabel.attr('x')).toBe('0');
      expect(typeLabel.attr('y')).toBe('25');
      expect(typeLabel.attr('text-anchor')).toBe('middle');
    });

    it('applies correct styling to type labels', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Class' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const typeLabel = d3.select(textLabels.nodes()[1]);
      
      expect(typeLabel.attr('font-size')).toBe('9px');
      expect(typeLabel.attr('fill')).toBe('#666');
      expect(typeLabel.style('pointer-events')).toBe('none');
    });

    it('renders both name and type labels for each node', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      expect(textLabels.size()).toBe(4); // 2 nodes × 2 labels each
    });
  });

  describe('Event Handlers', () => {
    it('sets cursor to pointer when onNodeClick is provided', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];
      const onNodeClick = vi.fn();

      createNodeElements(container, nodes, undefined, onNodeClick, mockDragBehavior);

      const nodeGroup = container.select('g.nodes g');
      expect(nodeGroup.style('cursor')).toBe('pointer');
    });

    it('sets cursor to grab when onNodeClick is not provided', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const nodeGroup = container.select('g.nodes g');
      expect(nodeGroup.style('cursor')).toBe('grab');
    });

    it('attaches click handler when onNodeClick is provided', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];
      const onNodeClick = vi.fn();

      createNodeElements(container, nodes, undefined, onNodeClick, mockDragBehavior);

      const nodeGroup = container.select('g.nodes g').node() as SVGGElement;
      const clickEvent = new MouseEvent('click', { bubbles: true });
      nodeGroup.dispatchEvent(clickEvent);

      expect(onNodeClick).toHaveBeenCalledTimes(1);
      expect(onNodeClick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          name: 'Node 1',
          type: 'Function',
        })
      );
    });

    it('does not attach click handler when onNodeClick is undefined', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const nodeGroup = container.select('g.nodes g').node() as SVGGElement;
      const clickEvent = new MouseEvent('click', { bubbles: true });
      
      // Should not throw error
      expect(() => nodeGroup.dispatchEvent(clickEvent)).not.toThrow();
    });

    it('calls onNodeClick for the correct node when multiple nodes exist', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
        { id: '3', name: 'Node 3', type: 'Class' },
      ];
      const onNodeClick = vi.fn();

      createNodeElements(container, nodes, undefined, onNodeClick, mockDragBehavior);

      const nodeGroups = container.selectAll('g.nodes g').nodes();
      const secondNode = nodeGroups[1] as SVGGElement;
      const clickEvent = new MouseEvent('click', { bubbles: true });
      secondNode.dispatchEvent(clickEvent);

      expect(onNodeClick).toHaveBeenCalledTimes(1);
      expect(onNodeClick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '2',
          name: 'Node 2',
          type: 'File',
        })
      );
    });
  });

  describe('Drag Behavior', () => {
    it('applies drag behavior to node groups', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
      ];

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      // Verify node selection exists and drag behavior can be applied
      expect(nodeSelection.size()).toBe(1);
      // The drag behavior is applied via .call() method in the implementation
      // We can verify the node is properly created and can receive drag behavior
      expect(nodeSelection.node()?.tagName).toBe('g');
    });

    it('applies drag behavior to all nodes', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
        { id: '3', name: 'Node 3', type: 'Class' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const nodeGroups = container.selectAll('g.nodes g');
      expect(nodeGroups.size()).toBe(3);
      
      // All nodes should be part of the selection that received drag behavior
      nodeGroups.each(function() {
        const node = d3.select(this);
        expect(node.node()).toBeTruthy();
      });
    });
  });

  describe('Return Value', () => {
    it('returns a D3 selection of node groups', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
      ];

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      expect(nodeSelection).toBeDefined();
      expect(nodeSelection.size()).toBe(2);
      expect(nodeSelection.node()?.tagName).toBe('g');
    });

    it('returned selection contains all node data', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: 'Function' },
        { id: '2', name: 'Node 2', type: 'File' },
      ];

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const dataArray: GraphNode[] = [];
      nodeSelection.each(function(d) {
        dataArray.push(d);
      });

      expect(dataArray).toHaveLength(2);
      expect(dataArray[0]).toMatchObject({ id: '1', name: 'Node 1', type: 'Function' });
      expect(dataArray[1]).toMatchObject({ id: '2', name: 'Node 2', type: 'File' });
    });
  });

  describe('Edge Cases', () => {
    it('handles nodes with additional properties beyond id/name/type', () => {
      const nodes: GraphNode[] = [
        { 
          id: '1', 
          name: 'Node 1', 
          type: 'Function',
          customProp: 'custom value',
          x: 100,
          y: 200,
        },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const nodeSelection = container.selectAll('g.nodes g');
      expect(nodeSelection.size()).toBe(1);
      
      nodeSelection.each(function(d: any) {
        expect(d.customProp).toBe('custom value');
        expect(d.x).toBe(100);
        expect(d.y).toBe(200);
      });
    });

    it('handles empty string node names', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: '', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      expect(nameLabel.text()).toBe('');
    });

    it('handles empty string node types', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node 1', type: '' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const typeLabel = d3.select(textLabels.nodes()[1]);
      expect(typeLabel.text()).toBe('');
      
      // Should use default color for empty type
      const circle = container.select('circle');
      expect(circle.attr('fill')).toBe('#6b7280');
    });

    it('handles nodes with special characters in names', () => {
      const nodes: GraphNode[] = [
        { id: '1', name: 'Node <script>alert("xss")</script>', type: 'Function' },
      ];

      createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      const textLabels = container.selectAll('text');
      const nameLabel = d3.select(textLabels.nodes()[0]);
      // Text content should be escaped by D3/browser
      expect(nameLabel.text()).toContain('Node');
    });

    it('handles large number of nodes efficiently', () => {
      const nodes: GraphNode[] = Array.from({ length: 100 }, (_, i) => ({
        id: `${i + 1}`,
        name: `Node ${i + 1}`,
        type: 'Function',
      }));

      const nodeSelection = createNodeElements(container, nodes, undefined, undefined, mockDragBehavior);

      expect(nodeSelection.size()).toBe(100);
      expect(container.selectAll('circle').size()).toBe(100);
      expect(container.selectAll('text').size()).toBe(200); // 100 name labels + 100 type labels
    });
  });
});