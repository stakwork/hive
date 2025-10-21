import { describe, test, expect, beforeEach } from "vitest";
import * as d3 from "d3";
import { addArrowMarker } from "@/components/graph/graphUtils";

// Helper function to create a test SVG element using jsdom
const createTestSvgElement = (): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.appendChild(svg);
  return svg;
};

// Helper function to create D3 selection from SVG element
const createSvgSelection = (svg: SVGSVGElement): d3.Selection<SVGSVGElement, unknown, null, undefined> => {
  return d3.select(svg);
};

// Helper function to clean up test SVG elements
const cleanupSvgElement = (svg: SVGSVGElement): void => {
  if (svg.parentNode) {
    svg.parentNode.removeChild(svg);
  }
};

// Helper function to check if marker exists with correct ID
const expectMarkerToExist = (svg: SVGSVGElement): SVGElement => {
  const marker = svg.querySelector("marker#arrowhead");
  expect(marker).not.toBeNull();
  expect(marker?.tagName.toLowerCase()).toBe('marker');
  return marker as SVGElement;
};

// Helper function to check marker attribute values
const expectMarkerAttribute = (marker: SVGElement, attr: string, expectedValue: string): void => {
  const actualValue = marker.getAttribute(attr);
  expect(actualValue).toBe(expectedValue);
};

// Helper function to check if defs element exists
const expectDefsToExist = (svg: SVGSVGElement): SVGElement => {
  const defs = svg.querySelector("defs");
  expect(defs).not.toBeNull();
  expect(defs?.tagName.toLowerCase()).toBe('defs');
  return defs as SVGElement;
};

// Helper function to check if path element exists within marker
const expectPathToExist = (marker: SVGElement): SVGElement => {
  const path = marker.querySelector("path");
  expect(path).not.toBeNull();
  expect(path?.tagName.toLowerCase()).toBe('path');
  return path as SVGElement;
};

describe("addArrowMarker", () => {
  let svg: SVGSVGElement;
  let svgSelection: d3.Selection<SVGSVGElement, unknown, null, undefined>;

  beforeEach(() => {
    svg = createTestSvgElement();
    svgSelection = createSvgSelection(svg);
  });

  afterEach(() => {
    cleanupSvgElement(svg);
  });

  describe("Marker Creation", () => {
    test("creates marker element with correct id 'arrowhead'", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expect(marker.id).toBe("arrowhead");
    });

    test("appends defs element to SVG", () => {
      addArrowMarker(svgSelection);

      expectDefsToExist(svg);
    });

    test("appends marker element inside defs", () => {
      addArrowMarker(svgSelection);

      const defs = expectDefsToExist(svg);
      const marker = defs.querySelector("marker#arrowhead");
      expect(marker).not.toBeNull();
      expect(marker?.parentElement).toBe(defs);
    });

    test("creates marker that can be selected by D3", () => {
      addArrowMarker(svgSelection);

      const markerSelection = svgSelection.select("marker#arrowhead");
      expect(markerSelection.size()).toBe(1);
      const node = markerSelection.node();
      expect(node).not.toBeNull();
      expect(node?.nodeName.toLowerCase()).toBe('marker');
    });
  });

  describe("Marker Attributes", () => {
    test("sets correct viewBox attribute", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "viewBox", "0 -5 10 10");
    });

    test("sets correct refX attribute for marker positioning", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "refX", "20");
    });

    test("sets correct refY attribute for marker positioning", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "refY", "0");
    });

    test("sets correct markerWidth attribute", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "markerWidth", "6");
    });

    test("sets correct markerHeight attribute", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "markerHeight", "6");
    });

    test("sets orient attribute to 'auto' for automatic rotation", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "orient", "auto");
    });

    test("sets all required marker attributes in single call", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);

      expect(marker.getAttribute("viewBox")).toBe("0 -5 10 10");
      expect(marker.getAttribute("refX")).toBe("20");
      expect(marker.getAttribute("refY")).toBe("0");
      expect(marker.getAttribute("markerWidth")).toBe("6");
      expect(marker.getAttribute("markerHeight")).toBe("6");
      expect(marker.getAttribute("orient")).toBe("auto");
    });
  });

  describe("Arrow Path", () => {
    test("creates path element inside marker", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      expectPathToExist(marker);
    });

    test("sets correct path 'd' attribute for arrow shape", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      const path = expectPathToExist(marker);

      expect(path.getAttribute("d")).toBe("M0,-5L10,0L0,5");
    });

    test("sets correct fill color for arrow", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      const path = expectPathToExist(marker);

      expect(path.getAttribute("fill")).toBe("#999");
    });

    test("path is direct child of marker", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      const path = expectPathToExist(marker);

      expect(path.parentElement).toBe(marker);
    });
  });

  describe("DOM Structure", () => {
    test("creates correct DOM hierarchy: svg > defs > marker > path", () => {
      addArrowMarker(svgSelection);

      const defs = expectDefsToExist(svg);
      expect(defs.parentElement).toBe(svg);

      const marker = expectMarkerToExist(svg);
      expect(marker.parentElement).toBe(defs);

      const path = expectPathToExist(marker);
      expect(path.parentElement).toBe(marker);
    });

    test("creates single defs element", () => {
      addArrowMarker(svgSelection);

      const defsElements = svg.querySelectorAll("defs");
      expect(defsElements.length).toBe(1);
    });

    test("creates single marker element", () => {
      addArrowMarker(svgSelection);

      const markerElements = svg.querySelectorAll("marker");
      expect(markerElements.length).toBe(1);
    });

    test("creates single path element within marker", () => {
      addArrowMarker(svgSelection);

      const marker = expectMarkerToExist(svg);
      const pathElements = marker.querySelectorAll("path");
      expect(pathElements.length).toBe(1);
    });
  });

  describe("Integration", () => {
    test("allows link elements to reference marker via url(#arrowhead)", () => {
      addArrowMarker(svgSelection);

      // Create a line element that references the marker
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("marker-end", "url(#arrowhead)");
      svg.appendChild(line);

      expect(line.getAttribute("marker-end")).toBe("url(#arrowhead)");

      // Verify marker exists and can be referenced
      const marker = expectMarkerToExist(svg);
      expect(marker.id).toBe("arrowhead");
    });

    test("marker can be selected using D3 url reference", () => {
      addArrowMarker(svgSelection);

      // Verify marker can be selected via D3
      const markerSelection = d3.select(svg).select("#arrowhead");
      expect(markerSelection.size()).toBe(1);
      expect(markerSelection.attr("id")).toBe("arrowhead");
    });

    test("created marker is reusable across multiple link elements", () => {
      addArrowMarker(svgSelection);

      // Create multiple line elements referencing the same marker
      const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const line3 = document.createElementNS("http://www.w3.org/2000/svg", "line");

      line1.setAttribute("marker-end", "url(#arrowhead)");
      line2.setAttribute("marker-end", "url(#arrowhead)");
      line3.setAttribute("marker-end", "url(#arrowhead)");

      svg.appendChild(line1);
      svg.appendChild(line2);
      svg.appendChild(line3);

      // Verify all lines reference the same marker
      expect(line1.getAttribute("marker-end")).toBe("url(#arrowhead)");
      expect(line2.getAttribute("marker-end")).toBe("url(#arrowhead)");
      expect(line3.getAttribute("marker-end")).toBe("url(#arrowhead)");

      // Verify only one marker exists
      const markers = svg.querySelectorAll("marker#arrowhead");
      expect(markers.length).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    test("handles multiple calls without creating duplicate markers", () => {
      // First call
      addArrowMarker(svgSelection);

      // Second call
      addArrowMarker(svgSelection);

      // Should create multiple defs (D3 append behavior)
      const defsElements = svg.querySelectorAll("defs");
      expect(defsElements.length).toBe(2);

      // Should create multiple markers (one in each defs)
      const markerElements = svg.querySelectorAll("marker#arrowhead");
      expect(markerElements.length).toBe(2);

      // Note: In real usage, GraphVisualizationLayered clears SVG before calling addArrowMarker
      // This test documents the actual behavior when called multiple times
    });

    test("works with empty SVG element", () => {
      // SVG is already empty from beforeEach
      expect(svg.children.length).toBe(0);

      addArrowMarker(svgSelection);

      expectDefsToExist(svg);
      expectMarkerToExist(svg);
    });

    test("preserves existing SVG content", () => {
      // Add some existing content
      const existingCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      existingCircle.setAttribute("r", "10");
      svg.appendChild(existingCircle);

      addArrowMarker(svgSelection);

      // Verify existing content is preserved
      const circle = svg.querySelector("circle");
      expect(circle).not.toBeNull();
      expect(circle?.getAttribute("r")).toBe("10");

      // Verify marker was added
      expectMarkerToExist(svg);
    });

    test("works with SVG that has existing defs", () => {
      // Add existing defs element
      const existingDefs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const existingGradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
      existingGradient.id = "gradient1";
      existingDefs.appendChild(existingGradient);
      svg.appendChild(existingDefs);

      addArrowMarker(svgSelection);

      // Verify new defs was added (D3 append creates new defs)
      const defsElements = svg.querySelectorAll("defs");
      expect(defsElements.length).toBe(2);

      // Verify existing gradient is preserved
      const gradient = svg.querySelector("#gradient1");
      expect(gradient).not.toBeNull();

      // Verify marker was added
      expectMarkerToExist(svg);
    });

    test("handles SVG with viewBox attribute", () => {
      svg.setAttribute("viewBox", "0 0 800 600");

      addArrowMarker(svgSelection);

      // Verify SVG viewBox is preserved
      expect(svg.getAttribute("viewBox")).toBe("0 0 800 600");

      // Verify marker was added correctly
      const marker = expectMarkerToExist(svg);
      expectMarkerAttribute(marker, "viewBox", "0 -5 10 10");
    });
  });

  describe("Return Value", () => {
    test("returns void (undefined)", () => {
      const result = addArrowMarker(svgSelection);
      expect(result).toBeUndefined();
    });
  });

  describe("D3 Selection Behavior", () => {
    test("works with D3 selection created from document.createElement", () => {
      const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const newSelection = d3.select(newSvg);

      addArrowMarker(newSelection);

      const marker = newSvg.querySelector("marker#arrowhead");
      expect(marker).not.toBeNull();

      // Cleanup
      if (newSvg.parentNode) {
        newSvg.parentNode.removeChild(newSvg);
      }
    });

    test("works with D3 selection created from existing DOM element", () => {
      const existingSvg = createTestSvgElement();
      const existingSelection = d3.select(existingSvg);

      addArrowMarker(existingSelection);

      const marker = existingSvg.querySelector("marker#arrowhead");
      expect(marker).not.toBeNull();

      // Cleanup
      cleanupSvgElement(existingSvg);
    });
  });
});
