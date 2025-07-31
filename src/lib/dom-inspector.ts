// DOM Inspector utilities for bug identification feature
// Uses unified debug source resolver with fallback chain (DevTools → Fiber → DOM heuristics)

import { DebugSourceResolver, DebugSourceResult } from './debug-source-resolver';
import { getDebugSourceConfig } from './debug-source-config';

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

export interface FallbackSourceInfo {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  context: string;
  method: 'react-fiber' | 'dom-heuristic' | 'component-name' | 'data-attributes';
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
 * Analyze DOM element for fallback source information when React fiber fails
 */
function getFallbackSourceInfo(element: Element): FallbackSourceInfo | null {
  try {
    // Method 1: Check for data attributes that might indicate component source
    const dataTestId = element.getAttribute('data-testid');
    const dataComponent = element.getAttribute('data-component');
    const className = element.className;
    
    if (dataTestId) {
      return {
        fileName: `components/${dataTestId}.tsx`,
        context: `Component with data-testid="${dataTestId}"`,
        method: 'data-attributes'
      };
    }
    
    if (dataComponent) {
      return {
        fileName: `components/${dataComponent}.tsx`,
        context: `Component with data-component="${dataComponent}"`,
        method: 'data-attributes'
      };
    }
    
    // Method 2: Analyze CSS classes for component patterns
    if (className && typeof className === 'string') {
      const classNames = className.split(' ');
      const componentClass = classNames.find(cls => 
        cls.match(/^[A-Z][a-zA-Z0-9]*(?:-[a-z]+)*$/) || // Component-like class names
        cls.includes('Component') ||
        cls.includes('component') ||
        cls.includes('_')
      );
      
      if (componentClass) {
        return {
          fileName: `components/${componentClass}.tsx`,
          context: `Element with CSS class "${componentClass}"`,
          method: 'dom-heuristic'
        };
      }
    }
    
    // Method 3: Analyze element hierarchy and patterns
    const tagName = element.tagName.toLowerCase();
    const id = element.id;
    
    if (id) {
      return {
        fileName: `components/${id}.tsx`,
        context: `Element with id="${id}" (${tagName})`,
        method: 'dom-heuristic'
      };
    }
    
    // Method 4: Generic element info
    return {
      fileName: `components/UnknownComponent.tsx`,
      context: `${tagName} element${className ? ` with classes: ${className}` : ''}`,
      method: 'dom-heuristic'
    };
    
  } catch (error) {
    console.error('Error analyzing element for fallback info:', error);
    return null;
  }
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

    console.log(`🔍 Checking React Fiber for ${element.tagName}${element.className ? '.' + element.className.split(' ')[0] : ''}:`, {
      hasFiber: !!fiber,
      fiberKeys: fiber ? Object.keys(fiber).filter(k => k.includes('debug') || k.includes('source') || k.includes('Source')) : [],
      _debugSource: fiber?._debugSource,
      __source: fiber?.memoizedProps?.__source,
      type: fiber?.type?.name || fiber?.elementType?.name
    });

    if (!fiber) return null;

    // SWC puts debug source directly on fiber
    if (fiber._debugSource) {
      console.log('   ✅ SUCCESS: Found _debugSource (SWC debug info):', fiber._debugSource);
      return fiber._debugSource;
    }

    // Fallback: check component props for source info
    if (fiber.memoizedProps?.__source) {
      console.log('   ✅ SUCCESS: Found __source in props (Babel transform):', fiber.memoizedProps.__source);
      return fiber.memoizedProps.__source;
    }

    // Additional debugging: check all possible locations
    const possibleSources = [
      fiber.__source,
      fiber.source,
      fiber._source,
      fiber.debugSource,
      fiber.stateNode?._debugSource,
      fiber.stateNode?.__source
    ].filter(Boolean);

    if (possibleSources.length > 0) {
      console.log('   🔧 PARTIAL: Found alternative sources:', possibleSources);
      return possibleSources[0];
    }

    console.log('   ❌ FAILED: No React fiber debug source found');
    return null;
  } catch (error) {
    console.error('❌ Error accessing React fiber:', error);
    return null;
  }
}

/**
 * Find React components at specific coordinates using the unified debug source resolver
 * This version uses the new fallback chain system (DevTools → Fiber → DOM heuristics)
 */
export async function findElementsAtCoordinates(x: number, y: number): Promise<SourceMapping[]> {
  try {
    const config = getDebugSourceConfig();
    const resolver = new DebugSourceResolver();
    
    // This function runs inside the iframe context, not from parent
    const element = document.elementFromPoint(x, y);
    
    if (config.enableLogging) {
      console.log('🎯 Finding elements at coordinates:', { x, y, element: element?.tagName, className: element?.className });
    }
    
    if (!element) return [];

    const sourceMappings: SourceMapping[] = [];
    
    // Start with the clicked element and walk up the DOM tree
    let currentElement: Element | null = element;
    
    while (currentElement && sourceMappings.length < 5) { // Limit to 5 levels to avoid too much data
      const result: DebugSourceResult = await resolver.resolveElement(currentElement);
      
      if (result.sources.length > 0) {
        for (const source of result.sources) {
          if (config.enableLogging) {
            console.log(`📍 Found source at depth ${sourceMappings.length} via ${result.activeMethod}:`, source);
          }
          
          sourceMappings.push({
            element: currentElement,
            fileName: source.fileName,
            lineNumber: source.lineNumber,
            columnNumber: source.columnNumber,
            text: source.context || currentElement.textContent?.trim()?.substring(0, 100) || undefined,
            selector: generateCssSelector(currentElement),
            bounds: currentElement.getBoundingClientRect()
          });
        }
      }
      
      currentElement = currentElement.parentElement;
    }

    // Generate detection method summary
    const fiberSources = sourceMappings.filter(m => m.lineNumber !== undefined);
    const fallbackSources = sourceMappings.filter(m => m.lineNumber === undefined);
    
    if (config.enableLogging) {
      console.log('🎯 SOURCE DETECTION SUMMARY:');
      console.log(`   Total sources found: ${sourceMappings.length}`);
      console.log(`   ✅ Precise sources: ${fiberSources.length} (accurate file:line mapping)`);
      console.log(`   🔧 Heuristic sources: ${fallbackSources.length} (estimated)`);
      
      if (fiberSources.length > 0) {
        console.log('   🎉 SUCCESS: Precise debug info is working!');
        fiberSources.forEach((source, i) => {
          console.log(`      ${i + 1}. ${source.fileName}:${source.lineNumber}`);
        });
      } else if (fallbackSources.length > 0) {
        console.log('   ⚠️  Using heuristic detection only');
        fallbackSources.forEach((source, i) => {
          console.log(`      Heuristic ${i + 1}: ${source.fileName}`);
        });
      }
    }
    
    return sourceMappings;
  } catch (error) {
    console.error('❌ Error finding elements at coordinates:', error);
    return [];
  }
}

/**
 * Find React components within a selection rectangle using the unified debug source resolver
 * Useful for drag selections that cover multiple components
 */
export async function findElementsInRegion(x: number, y: number, width: number, height: number): Promise<SourceMapping[]> {
  try {
    const config = getDebugSourceConfig();
    const resolver = new DebugSourceResolver();
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
      
      const result: DebugSourceResult = await resolver.resolveElement(element);
      if (result.sources.length > 0) {
        for (const source of result.sources) {
          sourceMappings.push({
            element,
            fileName: source.fileName,
            lineNumber: source.lineNumber,
            columnNumber: source.columnNumber,
            text: source.context || element.textContent?.trim()?.substring(0, 100) || undefined,
            selector: generateCssSelector(element),
            bounds: element.getBoundingClientRect()
          });
        }
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
  console.log('🎬 Initializing debug message listener');
  
  window.addEventListener('message', async (event) => {
    // Only respond to debug requests
    if (event.data?.type !== 'debug-request') return;
    
    console.log('📨 Received debug request:', event.data);
    
    try {
      const { messageId, coordinates } = event.data;
      const { x, y, width, height } = coordinates;
      
      let sourceMappings: SourceMapping[];
      
      if (width === 0 && height === 0) {
        // Point selection (click)
        console.log('🖱️ Processing click at:', { x, y });
        sourceMappings = await findElementsAtCoordinates(x, y);
      } else {
        // Area selection (drag)
        console.log('🖱️ Processing area selection:', { x, y, width, height });
        sourceMappings = await findElementsInRegion(x, y, width, height);
      }
      
      // Convert to simple format for postMessage (remove DOM element references)
      const sourceFiles = sourceMappings.map(mapping => ({
        file: mapping.fileName || 'unknown',
        lines: mapping.lineNumber ? [mapping.lineNumber] : [],
        context: mapping.text
      }));
      
      // Show final summary of what we're sending
      const fiberFiles = sourceFiles.filter(f => f.lines.length > 0);
      const fallbackFiles = sourceFiles.filter(f => f.lines.length === 0);
      
      console.log('📤 SENDING DEBUG RESPONSE:');
      console.log(`   Message ID: ${messageId}`);
      console.log(`   ✅ React Fiber files: ${fiberFiles.length}`);
      console.log(`   🔧 Fallback files: ${fallbackFiles.length}`);
      
      if (fiberFiles.length === 0 && fallbackFiles.length === 0) {
        console.log('   ❌ No source information found');
      }
      
      // Send response back to parent
      if (event.source) {
        event.source.postMessage({
          type: 'debug-response',
          messageId,
          success: true,
          sourceFiles
        }, event.origin);
      }
      
    } catch (error) {
      console.error('Error processing debug request:', error);
      
      // Send error response
      if (event.source) {
        event.source.postMessage({
          type: 'debug-response',
          messageId: event.data?.messageId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, event.origin);
      }
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

