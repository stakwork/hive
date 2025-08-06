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

// Helper functions

function rectsIntersect(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number },
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
  element: Element,
): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  try {
    // Find React fiber key
    const fiberKey = Object.keys(element).find(
      (key) =>
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$"),
    );

    if (!fiberKey) {
      return null;
    }

    // @ts-expect-error - Accessing React internals
    let fiber = element[fiberKey];
    let level = 0;

    // Get max traversal depth from env variable, default to 10
    const maxTraversalDepth =
      Number(process.env.NEXT_PUBLIC_REACT_FIBER_TRAVERSAL_DEPTH) || 10;

    // Helper to extract source from an object
    const extractSource = (
      source: {
        fileName?: string;
        lineNumber?: number;
        columnNumber?: number;
      } | null,
    ) => {
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
      };
    };

    // Traverse up the fiber tree to find debug source
    while (fiber && level < maxTraversalDepth) {
      // Check various locations where source info might be stored
      const source =
        fiber._debugSource ||
        fiber.memoizedProps?.__source ||
        fiber.pendingProps?.__source;

      if (source) {
        return extractSource(source);
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
    // Handle both debug requests and scan requests
    if (
      event.data?.type !== "debug-request" &&
      event.data?.type !== "scan-request"
    )
      return;

    // Handle scan requests
    if (event.data?.type === "scan-request") {
      const { messageId } = event.data;

      try {
        // Dynamically import scanner and run quick scan
        const { scanDebugDataInjection } = await import("./debug-data-scanner");
        const results = scanDebugDataInjection({ maxElements: 5000 });

        // Send compact results back
        event.source?.postMessage(
          {
            type: "scan-response",
            messageId,
            results: {
              totalElements: results.totalElements,
              elementsWithAnyDebugData: results.elementsWithAnyDebugData,
              elementsWithDataAttrs: results.elementsWithDataAttrs,
              elementsWithFiberSources: results.elementsWithFiberSources,
              coverage: results.coverage,
              sourceFileCount: results.sourceFiles.size,
            },
          },
          event.origin as WindowPostMessageOptions,
        );
      } catch (error) {
        console.error("Error running debug scan:", error);
        event.source?.postMessage(
          {
            type: "scan-response",
            messageId,
            error:
              error instanceof Error ? error.message : "Failed to run scan",
          },
          event.origin as WindowPostMessageOptions,
        );
      }
      return;
    }

    // Original debug-request handling continues below
    if (event.data?.type !== "debug-request") return;

    const { messageId, coordinates } = event.data;

    try {
      // Handle element finding directly since we're inside the target document

      // For direct DOM access (since we're inside the iframe), we need to search differently
      const sourceFiles: Array<{
        file: string;
        lines: number[];
        context?: string;
      }> = [];
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
            {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
            coordinates,
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
          element.getAttribute("data-line") ||
          element.getAttribute("data-inspector-line");

        if (dataSource && dataLine) {
          const lineNum = parseInt(dataLine, 10);
          if (
            !processedFiles.has(dataSource) ||
            !processedFiles.get(dataSource)?.has(lineNum)
          ) {
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

            if (
              !processedFiles.has(fileName) ||
              !processedFiles.get(fileName)?.has(lineNum)
            ) {
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
              const className = element.className
                ? `.${element.className.split(" ")[0]}`
                : "";
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
        event.origin as WindowPostMessageOptions,
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
        event.origin as WindowPostMessageOptions,
      );
    }
  });
}

// Initialize debug data scanner for comprehensive testing
if (typeof window !== "undefined") {
  import("./debug-data-scanner").then(() => {
    // Scanner functions are automatically made available globally via the scanner module
    console.log(
      "🔍 Debug data scanner loaded. Use debugScan.quick() to test debug injection coverage.",
    );
  });
}
