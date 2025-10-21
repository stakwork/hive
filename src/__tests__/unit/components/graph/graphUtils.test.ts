import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as d3 from "d3";
import { addArrowMarker } from "@/components/graph/graphUtils";

describe("addArrowMarker", () => {
  let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  let svgElement: SVGSVGElement;

  beforeEach(() => {
    // Create a fresh SVG element for each test using jsdom
    svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svgElement);
    svg = d3.select(svgElement);
  });

  afterEach(() => {
    // Cleanup DOM after each test
    document.body.removeChild(svgElement);
  });

  describe("Marker Creation", () => {
    test("creates marker definition with correct id 'arrowhead'", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.size()).toBe(1);
      expect(marker.attr("id")).toBe("arrowhead");
    });

    test("appends defs and marker elements to SVG", () => {
      addArrowMarker(svg);
      
      const defs = svg.select("defs");
      expect(defs.size()).toBe(1);
      
      const marker = defs.select("marker");
      expect(marker.size()).toBe(1);
    });

    test("creates marker as direct child of defs element", () => {
      addArrowMarker(svg);
      
      const defs = svg.select("defs");
      const marker = defs.select("marker#arrowhead");
      expect(marker.size()).toBe(1);
    });
  });

  describe("Marker Attributes", () => {
    test("sets correct viewBox attribute", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.attr("viewBox")).toBe("0 -5 10 10");
    });

    test("sets correct refX and refY positioning", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.attr("refX")).toBe("20");
      expect(marker.attr("refY")).toBe("0");
    });

    test("sets correct markerWidth and markerHeight", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.attr("markerWidth")).toBe("6");
      expect(marker.attr("markerHeight")).toBe("6");
    });

    test("sets orient attribute to 'auto' for automatic rotation", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.attr("orient")).toBe("auto");
    });

    test("sets all required attributes in a single call", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.attr("id")).toBe("arrowhead");
      expect(marker.attr("viewBox")).toBe("0 -5 10 10");
      expect(marker.attr("refX")).toBe("20");
      expect(marker.attr("refY")).toBe("0");
      expect(marker.attr("markerWidth")).toBe("6");
      expect(marker.attr("markerHeight")).toBe("6");
      expect(marker.attr("orient")).toBe("auto");
    });
  });

  describe("Arrow Path Element", () => {
    test("creates path element with correct 'd' attribute for arrow shape", () => {
      addArrowMarker(svg);
      
      const path = svg.select("marker#arrowhead path");
      expect(path.size()).toBe(1);
      expect(path.attr("d")).toBe("M0,-5L10,0L0,5");
    });

    test("applies correct fill color", () => {
      addArrowMarker(svg);
      
      const path = svg.select("marker#arrowhead path");
      expect(path.attr("fill")).toBe("#999");
    });

    test("path is direct child of marker element", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      const path = marker.select("path");
      expect(path.size()).toBe(1);
    });
  });

  describe("Integration with Links", () => {
    test("marker can be referenced by links via url(#arrowhead)", () => {
      addArrowMarker(svg);
      
      // Create a test link that references the marker
      svg.append("line")
        .attr("marker-end", "url(#arrowhead)");
      
      const link = svg.select("line");
      expect(link.attr("marker-end")).toBe("url(#arrowhead)");
      
      // Verify marker exists for reference
      const marker = svg.select("marker#arrowhead");
      expect(marker.size()).toBe(1);
    });

    test("multiple links can reference the same marker", () => {
      addArrowMarker(svg);
      
      // Create multiple links
      svg.append("line").attr("marker-end", "url(#arrowhead)");
      svg.append("line").attr("marker-end", "url(#arrowhead)");
      svg.append("line").attr("marker-end", "url(#arrowhead)");
      
      const links = svg.selectAll("line");
      expect(links.size()).toBe(3);
      
      // All should reference the same marker
      links.each(function() {
        expect(d3.select(this).attr("marker-end")).toBe("url(#arrowhead)");
      });
      
      // Only one marker should exist
      const markers = svg.selectAll("marker#arrowhead");
      expect(markers.size()).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    test("handles multiple calls without creating duplicate markers", () => {
      // First call
      addArrowMarker(svg);
      
      // Clear and call again (simulating re-render as done in GraphVisualizationLayered)
      svg.selectAll("*").remove();
      addArrowMarker(svg);
      
      const markers = svg.selectAll("marker#arrowhead");
      expect(markers.size()).toBe(1);
    });

    test("works with empty SVG element", () => {
      expect(svg.selectAll("*").size()).toBe(0);
      
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(marker.size()).toBe(1);
    });

    test("does not throw error when called on valid SVG selection", () => {
      expect(() => addArrowMarker(svg)).not.toThrow();
    });

    test("creates complete marker structure in single operation", () => {
      addArrowMarker(svg);
      
      // Verify complete structure
      const defs = svg.select("defs");
      const marker = defs.select("marker#arrowhead");
      const path = marker.select("path");
      
      expect(defs.size()).toBe(1);
      expect(marker.size()).toBe(1);
      expect(path.size()).toBe(1);
    });
  });

  describe("DOM Structure Validation", () => {
    test("creates proper SVG hierarchy: svg > defs > marker > path", () => {
      addArrowMarker(svg);
      
      // Verify hierarchy
      const defs = svg.select("defs");
      expect(defs.node()?.parentElement).toBe(svgElement);
      
      const marker = defs.select("marker");
      expect(marker.node()?.parentElement).toBe(defs.node());
      
      const path = marker.select("path");
      expect(path.node()?.parentElement).toBe(marker.node());
    });

    test("defs element is first child of SVG", () => {
      addArrowMarker(svg);
      
      const firstChild = svgElement.firstElementChild;
      expect(firstChild?.tagName).toBe("defs");
    });

    test("marker is only child of defs element", () => {
      addArrowMarker(svg);
      
      const defs = svg.select("defs");
      const children = defs.node()?.children;
      expect(children?.length).toBe(1);
      expect(children?.[0].tagName).toBe("marker");
    });

    test("path is only child of marker element", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      const children = marker.node()?.children;
      expect(children?.length).toBe(1);
      expect(children?.[0].tagName).toBe("path");
    });
  });

  describe("Attribute Value Types", () => {
    test("numeric attributes are stored as strings", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      expect(typeof marker.attr("refX")).toBe("string");
      expect(typeof marker.attr("refY")).toBe("string");
      expect(typeof marker.attr("markerWidth")).toBe("string");
      expect(typeof marker.attr("markerHeight")).toBe("string");
    });

    test("viewBox is formatted as space-separated string", () => {
      addArrowMarker(svg);
      
      const marker = svg.select("marker#arrowhead");
      const viewBox = marker.attr("viewBox");
      expect(viewBox).toBe("0 -5 10 10");
      expect(viewBox?.split(" ").length).toBe(4);
    });

    test("path 'd' attribute uses SVG path syntax", () => {
      addArrowMarker(svg);
      
      const path = svg.select("marker#arrowhead path");
      const d = path.attr("d");
      expect(d).toMatch(/^M[\d,-]+L[\d,]+L[\d,]+$/);
    });
  });
});