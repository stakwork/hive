// DOM Inspector utilities for bug identification feature
// Uses React fiber to extract source mappings since SWC automatically injects debug info

export interface SourceMapping {
  element: Element;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  text?: string;
  selector?: string;
  bounds?: DOMRect;
}

export interface ReactFiberDebugSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
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
 * Extract source file location from React component's fiber node
 * SWC injects this debug info automatically in development mode
 */
function getReactFiberSource(element: Element): ReactFiberDebugSource | null {
  try {
    // React stores internal data on DOM elements - try different property names across versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fiber = (element as any)._reactInternalFiber ||
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (element as any).__reactInternalInstance ||
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (element as any)._reactInternals;

    if (!fiber) return null;

    // SWC puts debug source directly on fiber
    if (fiber._debugSource) {
      return fiber._debugSource;
    }

    // Fallback: check component props for source info
    if (fiber.memoizedProps?.__source) {
      return fiber.memoizedProps.__source;
    }

    return null;
  } catch {
    // DOM element doesn't have React fiber - silently continue
    return null;
  }
}

/**
 * Find React components at specific coordinates and extract their source file locations
 * This version walks up the React fiber tree to find all relevant source mappings
 * Used when user clicks on iframe to identify which components they're pointing at
 */
export function findElementsAtCoordinates(x: number, y: number): SourceMapping[] {
  try {
    // This function runs inside the iframe context, not from parent
    const element = document.elementFromPoint(x, y);
    if (!element) return [];

    const sourceMappings: SourceMapping[] = [];
    
    // Start with the clicked element and walk up the DOM tree
    let currentElement: Element | null = element;
    
    while (currentElement && sourceMappings.length < 5) { // Limit to 5 levels to avoid too much data
      const sourceInfo = getReactFiberSource(currentElement);
      
      if (sourceInfo) {
        sourceMappings.push({
          element: currentElement,
          fileName: sourceInfo.fileName,
          lineNumber: sourceInfo.lineNumber,
          columnNumber: sourceInfo.columnNumber,
          text: currentElement.textContent?.trim()?.substring(0, 100) || undefined, // Limit text length
          selector: generateCssSelector(currentElement),
          bounds: currentElement.getBoundingClientRect()
        });
      }
      
      currentElement = currentElement.parentElement;
    }

    return sourceMappings;
  } catch (error) {
    console.error('Error finding elements at coordinates:', error);
    return [];
  }
}

/**
 * Find React components within a selection rectangle
 * Useful for drag selections that cover multiple components
 */
export function findElementsInRegion(x: number, y: number, width: number, height: number): SourceMapping[] {
  try {
    const sourceMappings: SourceMapping[] = [];
    const processedElements = new Set<Element>();
    
    // Sample multiple points within the selection area
    const samplePoints = [
      { x, y }, // Top-left
      { x: x + width/2, y }, // Top-center
      { x: x + width, y }, // Top-right
      { x, y: y + height/2 }, // Middle-left
      { x: x + width/2, y: y + height/2 }, // Center
      { x: x + width, y: y + height/2 }, // Middle-right
      { x, y: y + height }, // Bottom-left
      { x: x + width/2, y: y + height }, // Bottom-center
      { x: x + width, y: y + height }, // Bottom-right
    ];
    
    for (const point of samplePoints) {
      const element = document.elementFromPoint(point.x, point.y);
      if (!element || processedElements.has(element)) continue;
      
      processedElements.add(element);
      
      const sourceInfo = getReactFiberSource(element);
      if (sourceInfo) {
        sourceMappings.push({
          element,
          fileName: sourceInfo.fileName,
          lineNumber: sourceInfo.lineNumber,
          columnNumber: sourceInfo.columnNumber,
          text: element.textContent?.trim()?.substring(0, 100) || undefined,
          selector: generateCssSelector(element),
          bounds: element.getBoundingClientRect()
        });
      }
    }

    return sourceMappings;
  } catch (error) {
    console.error('Error finding elements in region:', error);
    return [];
  }
}

/**
 * Initialize debug message listener for iframe context
 * This should be called by target repositories that want to support bug identification
 */
export function initializeDebugMessageListener() {
  window.addEventListener('message', (event) => {
    // Only respond to debug requests
    if (event.data?.type !== 'debug-request') return;
    
    try {
      const { messageId, coordinates } = event.data;
      const { x, y, width, height } = coordinates;
      
      let sourceMappings: SourceMapping[];
      
      if (width === 0 && height === 0) {
        // Point selection (click)
        sourceMappings = findElementsAtCoordinates(x, y);
      } else {
        // Area selection (drag)
        sourceMappings = findElementsInRegion(x, y, width, height);
      }
      
      // Convert to simple format for postMessage (remove DOM element references)
      const sourceFiles = sourceMappings.map(mapping => ({
        file: mapping.fileName || 'unknown',
        lines: mapping.lineNumber ? [mapping.lineNumber] : [],
        context: mapping.text
      }));
      
      // Send response back to parent
      event.source?.postMessage({
        type: 'debug-response',
        messageId,
        success: true,
        sourceFiles
      }, event.origin);
      
    } catch (error) {
      console.error('Error processing debug request:', error);
      
      // Send error response
      event.source?.postMessage({
        type: 'debug-response',
        messageId: event.data?.messageId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, event.origin);
    }
  });
}

/**
 * Generate CSS selector for an element - prioritizes ID, then classes, then tag name
 * Used for debugging and element identification in bug reports
 */
function generateCssSelector(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }
  
  if (element.className) {
    const classes = element.className.trim().split(/\s+/).slice(0, 2);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
    }
  }
  
  return element.tagName.toLowerCase();
}

