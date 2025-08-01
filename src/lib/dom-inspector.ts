// DOM Inspector utilities for bug identification feature

export interface SourceMapping {
  element: Element;
  source?: string;
  line?: string;
  column?: string;
  text?: string;
  selector?: string;
  bounds?: DOMRect;
}

export interface DebugSelection {
  elements: SourceMapping[];
  description?: string;
  coordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Extract source mappings from iframe DOM
 */
export function extractSourceMappings(iframe: HTMLIFrameElement): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      return [];
    }

    // First try to find elements with explicit source mapping attributes
    const elementsWithSource = doc.querySelectorAll(
      "[data-source], [data-inspector-line], [data-inspector-column]"
    );

    const mappings: SourceMapping[] = [];

    // Process elements with data attributes
    Array.from(elementsWithSource).forEach((element) => {
      const mapping: SourceMapping = {
        element,
        source:
          element.getAttribute("data-source") ||
          element.getAttribute("data-inspector-relative-path") ||
          undefined,
        line:
          element.getAttribute("data-inspector-line") ||
          element.getAttribute("data-line") ||
          undefined,
        column:
          element.getAttribute("data-inspector-column") ||
          element.getAttribute("data-column") ||
          undefined,
        text: element.textContent?.trim() || undefined,
        selector: generateSelector(element),
        bounds: element.getBoundingClientRect(),
      };
      mappings.push(mapping);
    });

    // If no elements with data attributes, try React fiber extraction on all elements
    if (mappings.length === 0) {
      const allElements = doc.querySelectorAll("*");
      Array.from(allElements).forEach((element) => {
        const debugSource = extractReactDebugSource(element);
        if (debugSource && debugSource.fileName) {
          mappings.push({
            element,
            source: debugSource.fileName,
            line: debugSource.lineNumber?.toString(),
            column: debugSource.columnNumber?.toString(),
            text: element.textContent?.trim() || undefined,
            selector: generateSelector(element),
            bounds: element.getBoundingClientRect(),
          });
        }
      });
    }

    return mappings;
  } catch (error) {
    console.error("Error extracting source mappings:", error);
    return [];
  }
}

/**
 * Find elements that match text description
 */
export function findElementsByDescription(
  iframe: HTMLIFrameElement,
  description: string
): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const keywords = description
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);
    const allMappings = extractSourceMappings(iframe);

    // Score elements based on text content match
    const scoredElements = allMappings
      .map((mapping) => {
        const text = mapping.text?.toLowerCase() || "";
        const score = keywords.reduce((acc, keyword) => {
          return acc + (text.includes(keyword) ? 1 : 0);
        }, 0);
        return { ...mapping, score };
      })
      .filter((mapping) => mapping.score > 0)
      .sort((a, b) => b.score - a.score);

    return scoredElements;
  } catch (error) {
    console.error("Error finding elements by description:", error);
    return [];
  }
}

/**
 * Find elements at specific coordinates
 */
export function findElementsAtCoordinates(
  iframe: HTMLIFrameElement,
  x: number,
  y: number
): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const element = doc.elementFromPoint(x, y);
    if (!element) return [];

    // Get the element and its parents
    const elementsToCheck: Element[] = [];
    let current: Element | null = element;

    while (current && current !== doc.body) {
      elementsToCheck.push(current);
      current = current.parentElement;
    }

    const mappings: SourceMapping[] = [];

    // Check each element for source mappings
    elementsToCheck.forEach((el) => {
      // First check for data attributes
      if (hasSourceMapping(el)) {
        mappings.push({
          element: el,
          source:
            el.getAttribute("data-source") ||
            el.getAttribute("data-inspector-relative-path") ||
            undefined,
          line: el.getAttribute("data-inspector-line") || el.getAttribute("data-line") || undefined,
          column:
            el.getAttribute("data-inspector-column") || el.getAttribute("data-column") || undefined,
          text: el.textContent?.trim() || undefined,
          selector: generateSelector(el),
          bounds: el.getBoundingClientRect(),
        });
      } else {
        // Try React fiber extraction
        const debugSource = extractReactDebugSource(el);
        if (debugSource && debugSource.fileName) {
          mappings.push({
            element: el,
            source: debugSource.fileName,
            line: debugSource.lineNumber?.toString(),
            column: debugSource.columnNumber?.toString(),
            text: el.textContent?.trim() || undefined,
            selector: generateSelector(el),
            bounds: el.getBoundingClientRect(),
          });
        }
      }
    });

    return mappings;
  } catch (error) {
    console.error("Error finding elements at coordinates:", error);
    return [];
  }
}

/**
 * Find elements within a selection rectangle
 */
export function findElementsInRegion(
  iframe: HTMLIFrameElement,
  x: number,
  y: number,
  width: number,
  height: number
): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const allMappings = extractSourceMappings(iframe);
    const selectionRect = { x, y, width, height };

    // Find elements that intersect with the selection rectangle
    return allMappings.filter((mapping) => {
      if (!mapping.bounds) return false;

      return rectsIntersect(
        {
          x: mapping.bounds.left,
          y: mapping.bounds.top,
          width: mapping.bounds.width,
          height: mapping.bounds.height,
        },
        selectionRect
      );
    });
  } catch (error) {
    console.error("Error finding elements in region:", error);
    return [];
  }
}

// Helper functions

function hasSourceMapping(element: Element): boolean {
  // Check for data attributes
  if (
    element.getAttribute("data-source") ||
    element.getAttribute("data-inspector-line") ||
    element.getAttribute("data-line") ||
    element.getAttribute("data-inspector-relative-path")
  ) {
    return true;
  }

  // Check for React fiber debug source
  const debugSource = extractReactDebugSource(element);
  return !!(debugSource && debugSource.fileName);
}

function generateSelector(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.className) {
    const classes = element.className.trim().split(/\s+/).slice(0, 2);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.join(".")}`;
    }
  }

  return element.tagName.toLowerCase();
}

function rectsIntersect(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * Extract React fiber debug source information from a DOM element
 */
function extractReactDebugSource(
  element: Element
): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  try {
    // Look for React fiber keys (React 17+)
    const allKeys = Object.keys(element);

    // Also check for older React versions
    const fiberKey = allKeys.find(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    );


    if (!fiberKey) {
      return null;
    }

    // @ts-expect-error - Accessing React internals
    let fiber = element[fiberKey];

    let level = 0;
    // Traverse up the fiber tree to find debug source
    while (fiber && level < 10) {
      // Limit traversal to prevent infinite loops

      if (fiber._debugSource) {
        return {
          fileName: fiber._debugSource.fileName,
          lineNumber: fiber._debugSource.lineNumber,
          columnNumber: fiber._debugSource.columnNumber,
        };
      }

      // Also check for __source prop (used in some React setups)
      if (fiber.memoizedProps && fiber.memoizedProps.__source) {
        return {
          fileName: fiber.memoizedProps.__source.fileName,
          lineNumber: fiber.memoizedProps.__source.lineNumber,
          columnNumber: fiber.memoizedProps.__source.columnNumber,
        };
      }

      // Check for __source in other prop locations
      if (fiber.pendingProps && fiber.pendingProps.__source) {
        return {
          fileName: fiber.pendingProps.__source.fileName,
          lineNumber: fiber.pendingProps.__source.lineNumber,
          columnNumber: fiber.pendingProps.__source.columnNumber,
        };
      }


      // Go up the component tree
      fiber = fiber.return;
      level++;
    }

    return null;
  } catch (error) {
    console.error("Error extracting React debug source:", error);
    return null;
  }
}

/**
 * Initialize debug message listener for when this app is loaded in an iframe
 */
export function initializeDebugMessageListener() {
  if (typeof window === "undefined") return;

  window.addEventListener("message", async (event) => {
    // Only handle debug requests
    if (event.data?.type !== "debug-request") return;

    const { messageId, coordinates } = event.data;

    try {
      // Note: The findElementsAtCoordinates and findElementsInRegion functions are designed for iframe access,
      // but since we're inside the target document, we'll handle element finding directly below

      // For direct DOM access (since we're inside the iframe), we need to search differently
      const sourceFiles: Array<{ file: string; lines: number[]; context?: string }> = [];
      const processedFiles = new Map<string, Set<number>>();

      // Get element at point or elements in region
      let elementsToProcess: Element[] = [];


      if (coordinates.width === 0 && coordinates.height === 0) {
        // Click mode - get element at point
        const element = document.elementFromPoint(coordinates.x, coordinates.y);

        if (element) {
          elementsToProcess = [element];
          // Also include parents up to body
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            elementsToProcess.push(parent);
            parent = parent.parentElement;
          }
        }
      } else {
        // Selection mode - get all elements in the rectangle
        const allElements = document.querySelectorAll("*");
        elementsToProcess = Array.from(allElements).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rectsIntersect(
            { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            coordinates
          );
        });
      }

      // Process each element to extract debug source
      for (const element of elementsToProcess) {
        // First check for data attributes (if using react-dev-inspector or similar)
        const dataSource =
          element.getAttribute("data-source") ||
          element.getAttribute("data-inspector-relative-path");
        const dataLine =
          element.getAttribute("data-line") || element.getAttribute("data-inspector-line");

        if (dataSource && dataLine) {
          const lineNum = parseInt(dataLine, 10);
          if (!processedFiles.has(dataSource) || !processedFiles.get(dataSource)?.has(lineNum)) {
            if (!processedFiles.has(dataSource)) {
              processedFiles.set(dataSource, new Set());
            }
            processedFiles.get(dataSource)!.add(lineNum);

            // Find existing file entry or create new one
            let fileEntry = sourceFiles.find((f) => f.file === dataSource);
            if (!fileEntry) {
              fileEntry = { file: dataSource, lines: [] };
              sourceFiles.push(fileEntry);
            }
            fileEntry.lines.push(lineNum);
          }
        } else {
          // Fall back to React fiber debug source
          const debugSource = extractReactDebugSource(element);
          if (debugSource && debugSource.fileName && debugSource.lineNumber) {
            const fileName = debugSource.fileName;
            const lineNum = debugSource.lineNumber;

            if (!processedFiles.has(fileName) || !processedFiles.get(fileName)?.has(lineNum)) {
              if (!processedFiles.has(fileName)) {
                processedFiles.set(fileName, new Set());
              }
              processedFiles.get(fileName)!.add(lineNum);

              // Find existing file entry or create new one
              let fileEntry = sourceFiles.find((f) => f.file === fileName);
              if (!fileEntry) {
                fileEntry = { file: fileName, lines: [] };
                sourceFiles.push(fileEntry);
              }
              fileEntry.lines.push(lineNum);

              // Add context about the element
              const tagName = element.tagName.toLowerCase();
              const className = element.className ? `.${element.className.split(" ")[0]}` : "";
              fileEntry.context = `${tagName}${className}`;
            }
          }
        }
      }

      // Sort lines within each file
      sourceFiles.forEach((file) => {
        file.lines.sort((a, b) => a - b);
      });


      // Send response back to parent frame
      event.source?.postMessage(
        {
          type: "debug-response",
          messageId,
          success: true,
          sourceFiles,
        },
        event.origin as WindowPostMessageOptions
      );
    } catch (error) {
      console.error("Error processing debug request:", error);

      // Send error response
      event.source?.postMessage(
        {
          type: "debug-response",
          messageId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          sourceFiles: [],
        },
        event.origin as WindowPostMessageOptions
      );
    }
  });

}
