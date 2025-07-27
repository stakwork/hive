import { useState, useCallback } from 'react';
import { 
  extractSourceMappings, 
  findElementsByDescription, 
  findElementsAtCoordinates,
  findElementsInRegion,
  SourceMapping,
  DebugSelection 
} from '@/lib/dom-inspector';

export interface BugIdentificationResult {
  sourceFiles: Array<{
    file: string;
    lines: number[];
    context?: string;
  }>;
  description: string;
  method: 'click' | 'selection' | 'description';
}

export function useBugIdentification() {
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [currentSelection, setCurrentSelection] = useState<DebugSelection | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode(prev => !prev);
    if (isDebugMode) {
      setCurrentSelection(null);
    }
  }, [isDebugMode]);

  const identifyByClick = useCallback(async (
    iframe: HTMLIFrameElement,
    x: number,
    y: number,
    description?: string
  ): Promise<BugIdentificationResult> => {
    setIsProcessing(true);
    
    try {
      const elements = findElementsAtCoordinates(iframe, x, y);
      const sourceFiles = extractSourceFiles(elements);
      
      const selection: DebugSelection = {
        elements,
        description,
        coordinates: { x, y, width: 0, height: 0 }
      };
      
      setCurrentSelection(selection);
      
      return {
        sourceFiles,
        description: description || `Clicked element at (${x}, ${y})`,
        method: 'click'
      };
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const identifyBySelection = useCallback(async (
    iframe: HTMLIFrameElement,
    x: number,
    y: number,
    width: number,
    height: number,
    description?: string
  ): Promise<BugIdentificationResult> => {
    setIsProcessing(true);
    
    try {
      const elements = findElementsInRegion(iframe, x, y, width, height);
      const sourceFiles = extractSourceFiles(elements);
      
      const selection: DebugSelection = {
        elements,
        description,
        coordinates: { x, y, width, height }
      };
      
      setCurrentSelection(selection);
      
      return {
        sourceFiles,
        description: description || `Selected region (${width}x${height} at ${x},${y})`,
        method: 'selection'
      };
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const identifyByDescription = useCallback(async (
    iframe: HTMLIFrameElement,
    description: string
  ): Promise<BugIdentificationResult> => {
    setIsProcessing(true);
    
    try {
      const elements = findElementsByDescription(iframe, description);
      const sourceFiles = extractSourceFiles(elements);
      
      const selection: DebugSelection = {
        elements,
        description
      };
      
      setCurrentSelection(selection);
      
      return {
        sourceFiles,
        description,
        method: 'description'
      };
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setCurrentSelection(null);
  }, []);

  return {
    isDebugMode,
    currentSelection,
    isProcessing,
    toggleDebugMode,
    identifyByClick,
    identifyBySelection,
    identifyByDescription,
    clearSelection
  };
}

// Helper function to extract and deduplicate source files
function extractSourceFiles(elements: SourceMapping[]): Array<{
  file: string;
  lines: number[];
  context?: string;
}> {
  const fileMap = new Map<string, Set<number>>();
  const contextMap = new Map<string, string>();
  
  elements.forEach(element => {
    if (element.source && element.line) {
      const line = parseInt(element.line, 10);
      if (!isNaN(line)) {
        if (!fileMap.has(element.source)) {
          fileMap.set(element.source, new Set());
        }
        fileMap.get(element.source)!.add(line);
        
        // Store context (element text) for the file
        if (element.text && !contextMap.has(element.source)) {
          contextMap.set(element.source, element.text);
        }
      }
    }
  });
  
  return Array.from(fileMap.entries()).map(([file, linesSet]) => ({
    file,
    lines: Array.from(linesSet).sort((a, b) => a - b),
    context: contextMap.get(file)
  }));
}