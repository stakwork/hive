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
      console.warn('Cannot access iframe document - likely due to CORS');
      return [];
    }

    // Find elements with source mapping attributes
    const elementsWithSource = doc.querySelectorAll('[data-source], [data-inspector-line], [data-inspector-column]');
    
    return Array.from(elementsWithSource).map(element => ({
      element,
      source: element.getAttribute('data-source') || undefined,
      line: element.getAttribute('data-inspector-line') || element.getAttribute('data-line') || undefined,
      column: element.getAttribute('data-inspector-column') || element.getAttribute('data-column') || undefined,
      text: element.textContent?.trim() || undefined,
      selector: generateSelector(element),
      bounds: element.getBoundingClientRect()
    }));
  } catch (error) {
    console.error('Error extracting source mappings:', error);
    return [];
  }
}

/**
 * Find elements that match text description
 */
export function findElementsByDescription(iframe: HTMLIFrameElement, description: string): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const keywords = description.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const allMappings = extractSourceMappings(iframe);
    
    // Score elements based on text content match
    const scoredElements = allMappings
      .map(mapping => {
        const text = mapping.text?.toLowerCase() || '';
        const score = keywords.reduce((acc, keyword) => {
          return acc + (text.includes(keyword) ? 1 : 0);
        }, 0);
        return { ...mapping, score };
      })
      .filter(mapping => mapping.score > 0)
      .sort((a, b) => b.score - a.score);

    return scoredElements;
  } catch (error) {
    console.error('Error finding elements by description:', error);
    return [];
  }
}

/**
 * Find elements at specific coordinates
 */
export function findElementsAtCoordinates(iframe: HTMLIFrameElement, x: number, y: number): SourceMapping[] {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return [];

    const element = doc.elementFromPoint(x, y);
    if (!element) return [];

    // Get the element and its parents with source mappings
    const elementsWithSource: Element[] = [];
    let current: Element | null = element;
    
    while (current && current !== doc.body) {
      if (hasSourceMapping(current)) {
        elementsWithSource.push(current);
      }
      current = current.parentElement;
    }

    return elementsWithSource.map(el => ({
      element: el,
      source: el.getAttribute('data-source') || undefined,
      line: el.getAttribute('data-inspector-line') || el.getAttribute('data-line') || undefined,
      column: el.getAttribute('data-inspector-column') || el.getAttribute('data-column') || undefined,
      text: el.textContent?.trim() || undefined,
      selector: generateSelector(el),
      bounds: el.getBoundingClientRect()
    }));
  } catch (error) {
    console.error('Error finding elements at coordinates:', error);
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
    return allMappings.filter(mapping => {
      if (!mapping.bounds) return false;
      
      return rectsIntersect(
        { x: mapping.bounds.left, y: mapping.bounds.top, width: mapping.bounds.width, height: mapping.bounds.height },
        selectionRect
      );
    });
  } catch (error) {
    console.error('Error finding elements in region:', error);
    return [];
  }
}

// Helper functions

function hasSourceMapping(element: Element): boolean {
  return !!(
    element.getAttribute('data-source') ||
    element.getAttribute('data-inspector-line') ||
    element.getAttribute('data-line')
  );
}

function generateSelector(element: Element): string {
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

function rectsIntersect(rect1: { x: number; y: number; width: number; height: number }, rect2: { x: number; y: number; width: number; height: number }): boolean {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}