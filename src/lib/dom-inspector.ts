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
 * Find React component at specific coordinates and extract its source file location
 * Used when user clicks on iframe to identify which component they're pointing at
 */
export function findElementsAtCoordinates(iframe: HTMLIFrameElement, x: number, y: number): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const element = doc.elementFromPoint(x, y);
    if (!element) return [];

    const sourceInfo = getReactFiberSource(element);
    if (!sourceInfo) return [];

    return [{
      element,
      fileName: sourceInfo.fileName,
      lineNumber: sourceInfo.lineNumber,
      columnNumber: sourceInfo.columnNumber,
      text: element.textContent?.trim() || undefined,
      selector: generateCssSelector(element),
      bounds: element.getBoundingClientRect()
    }];
  } catch (error) {
    console.error('Error finding elements at coordinates:', error);
    return [];
  }
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

