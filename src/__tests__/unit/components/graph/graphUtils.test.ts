import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { addArrowMarker } from '@/components/graph/graphUtils';

describe('addArrowMarker', () => {
  let svgElement: SVGSVGElement;
  let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

  // Helper function to get marker element
  const getMarker = () => svgElement.querySelector('marker#arrowhead');

  beforeEach(() => {
    // Create a fresh SVG element for each test
    svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svgElement);
    svg = d3.select(svgElement);
  });

  afterEach(() => {
    // Clean up DOM
    document.body.removeChild(svgElement);
  });

  describe('Marker Creation', () => {
    it('creates marker definition with correct id "arrowhead"', () => {
      addArrowMarker(svg);

      const marker = getMarker();
      expect(marker).not.toBeNull();
      expect(marker?.getAttribute('id')).toBe('arrowhead');
    });

    it('appends defs and marker elements to SVG', () => {
      addArrowMarker(svg);

      const defs = svgElement.querySelector('defs');
      expect(defs).not.toBeNull();

      const marker = defs?.querySelector('marker');
      expect(marker).not.toBeNull();
    });

    it('creates exactly one marker element', () => {
      addArrowMarker(svg);

      const markers = svgElement.querySelectorAll('marker');
      expect(markers.length).toBe(1);
    });
  });

  describe('Marker Attributes', () => {
    beforeEach(() => {
      addArrowMarker(svg);
    });

    it('sets correct viewBox attribute', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('viewBox')).toBe('0 -5 10 10');
    });

    it('sets correct refX positioning attribute', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('refX')).toBe('20');
    });

    it('sets correct refY positioning attribute', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('refY')).toBe('0');
    });

    it('sets correct markerWidth', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('markerWidth')).toBe('6');
    });

    it('sets correct markerHeight', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('markerHeight')).toBe('6');
    });

    it('sets orient="auto" for automatic rotation', () => {
      const marker = getMarker();
      expect(marker?.getAttribute('orient')).toBe('auto');
    });
  });

  describe('Arrow Path', () => {
    beforeEach(() => {
      addArrowMarker(svg);
    });

    it('creates path element inside marker', () => {
      const marker = getMarker();
      const path = marker?.querySelector('path');
      expect(path).not.toBeNull();
    });

    it('sets correct "d" attribute for arrow shape', () => {
      const marker = getMarker();
      const path = marker?.querySelector('path');
      expect(path?.getAttribute('d')).toBe('M0,-5L10,0L0,5');
    });

    it('applies correct fill color', () => {
      const marker = getMarker();
      const path = marker?.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('#999');
    });
  });

  describe('Integration with Links', () => {
    it('allows links to reference marker via url(#arrowhead)', () => {
      addArrowMarker(svg);

      // Create a test line element that references the marker
      const g = svg.append('g');
      const line = g.append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', 100)
        .attr('y2', 100)
        .attr('marker-end', 'url(#arrowhead)');

      const lineElement = line.node();
      expect(lineElement?.getAttribute('marker-end')).toBe('url(#arrowhead)');

      // Verify marker exists and can be referenced
      const marker = getMarker();
      expect(marker).not.toBeNull();
    });

    it('marker can be found via getElementById', () => {
      addArrowMarker(svg);

      // Note: jsdom may not fully support getElementById on SVG elements,
      // but we can verify the marker exists with the correct id
      const marker = svgElement.querySelector('#arrowhead');
      expect(marker).not.toBeNull();
      expect(marker?.tagName.toLowerCase()).toBe('marker');
    });
  });

  describe('Edge Cases', () => {
    it('handles multiple calls by creating multiple markers', () => {
      // First call
      addArrowMarker(svg);
      
      // Second call - addArrowMarker doesn't prevent duplicates,
      // it's the caller's responsibility to clear the SVG first
      addArrowMarker(svg);

      // Should have 2 defs elements with 2 markers
      const markers = svgElement.querySelectorAll('marker#arrowhead');
      expect(markers.length).toBe(2);
    });

    it('works with empty SVG element', () => {
      // SVG is already empty from beforeEach
      expect(svgElement.children.length).toBe(0);

      addArrowMarker(svg);

      const marker = getMarker();
      expect(marker).not.toBeNull();
    });

    it('works with SVG that already has other content', () => {
      // Add some existing content
      svg.append('circle').attr('r', 10);
      svg.append('text').text('test');

      addArrowMarker(svg);

      // Verify marker was added
      const marker = getMarker();
      expect(marker).not.toBeNull();

      // Verify existing content is still there
      expect(svgElement.querySelector('circle')).not.toBeNull();
      expect(svgElement.querySelector('text')).not.toBeNull();
    });

    it('marker survives when used with D3 selections', () => {
      addArrowMarker(svg);

      // Perform typical D3 operations
      const g = svg.append('g').attr('class', 'test-group');
      g.selectAll('line')
        .data([1, 2, 3])
        .enter()
        .append('line')
        .attr('marker-end', 'url(#arrowhead)');

      // Marker should still exist
      const marker = getMarker();
      expect(marker).not.toBeNull();

      // All lines should reference the marker
      const lines = svgElement.querySelectorAll('line');
      expect(lines.length).toBe(3);
      lines.forEach(line => {
        expect(line.getAttribute('marker-end')).toBe('url(#arrowhead)');
      });
    });
  });

  describe('DOM Structure', () => {
    it('creates correct nested structure: defs > marker > path', () => {
      addArrowMarker(svg);

      const defs = svgElement.querySelector('defs');
      expect(defs).not.toBeNull();
      expect(defs?.parentElement).toBe(svgElement);

      const marker = defs?.querySelector('marker');
      expect(marker).not.toBeNull();
      expect(marker?.parentElement).toBe(defs);

      const path = marker?.querySelector('path');
      expect(path).not.toBeNull();
      expect(path?.parentElement).toBe(marker);
    });

    it('marker element has no other children besides path', () => {
      addArrowMarker(svg);

      const marker = getMarker();
      expect(marker?.children.length).toBe(1);
      expect(marker?.children[0].tagName.toLowerCase()).toBe('path');
    });

    it('defs element contains only the marker', () => {
      addArrowMarker(svg);

      const defs = svgElement.querySelector('defs');
      expect(defs?.children.length).toBe(1);
      expect(defs?.children[0].tagName.toLowerCase()).toBe('marker');
    });
  });
});