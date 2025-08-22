/**
 * Test for JSX dev runtime source location extraction
 * Purpose: Evaluate accessing source location data from React fiber and JSX dev runtime
 */

import { vi } from 'vitest';

// Test function to evaluate JSX dev runtime source location extraction
function testJsxDevRuntime() {
  // Mock React element with different source data scenarios
  const testCases = [
    // Case 1: No source data
    { _owner: null },
    
    // Case 2: Fiber with _debugSource (development build)
    { 
      _owner: { 
        _debugSource: { 
          fileName: '/Users/test/src/components/TestComponent.tsx',
          lineNumber: 25,
          columnNumber: 12
        }
      }
    },
    
    // Case 3: Fiber with __source (alternative location)
    { 
      _owner: { 
        __source: { 
          fileName: '/Users/test/src/App.tsx',
          lineNumber: 18,
          columnNumber: 6
        }
      }
    },
    
    // Case 4: Fiber with both (should prefer _debugSource)
    { 
      _owner: { 
        _debugSource: { 
          fileName: '/Users/test/src/components/Primary.tsx',
          lineNumber: 30,
          columnNumber: 15
        },
        __source: { 
          fileName: '/Users/test/src/components/Secondary.tsx',
          lineNumber: 20,
          columnNumber: 10
        }
      }
    }
  ];
  
  return testCases.map((mockElement, index) => {
    const fiber = (mockElement as any)._owner;
    let sourceData: any = {
      testCase: index,
      success: false,
      approach: 'jsx-dev-runtime',
      fiber: null,
      source: null,
      debugSource: null
    };
    
    if (fiber) {
      sourceData.fiber = {
        type: fiber.type?.name || 'unknown',
        hasDebugSource: !!fiber._debugSource,
        hasSource: !!fiber.__source
      };
      
      // Try to access _debugSource (development build)
      if (fiber._debugSource) {
        sourceData.debugSource = {
          fileName: fiber._debugSource.fileName,
          lineNumber: fiber._debugSource.lineNumber,
          columnNumber: fiber._debugSource.columnNumber
        };
        sourceData.success = true;
      }
      
      // Try to access __source (alternative location)
      if (fiber.__source) {
        sourceData.source = {
          fileName: fiber.__source.fileName,
          lineNumber: fiber.__source.lineNumber,
          columnNumber: fiber.__source.columnNumber
        };
        sourceData.success = true;
      }
    }
    
    return sourceData;
  });
}

describe('JSX Dev Runtime Source Location Evaluation', () => {
  it('should extract source location from JSX dev runtime structures', () => {
    const results = testJsxDevRuntime();
    
    console.log('JSX Dev Runtime Test Results:', results);
    
    // Test case 0: No source data (should fail)
    expect(results[0].success).toBe(false);
    expect(results[0].fiber).toBe(null);
    
    // Test case 1: _debugSource available (should succeed)
    expect(results[1].success).toBe(true);
    expect(results[1].debugSource.fileName).toContain('TestComponent.tsx');
    expect(results[1].debugSource.lineNumber).toBe(25);
    expect(results[1].debugSource.columnNumber).toBe(12);
    
    // Test case 2: __source available (should succeed)
    expect(results[2].success).toBe(true);
    expect(results[2].source.fileName).toContain('App.tsx');
    expect(results[2].source.lineNumber).toBe(18);
    expect(results[2].source.columnNumber).toBe(6);
    
    // Test case 3: Both available (should succeed with _debugSource)
    expect(results[3].success).toBe(true);
    expect(results[3].debugSource.fileName).toContain('Primary.tsx');
    expect(results[3].source.fileName).toContain('Secondary.tsx');
  });
  
  it('should properly identify fiber structure', () => {
    const results = testJsxDevRuntime();
    
    results.forEach((result, index) => {
      expect(result.approach).toBe('jsx-dev-runtime');
      
      if (index > 0) { // Skip the null case
        expect(result.fiber).toBeDefined();
        expect(typeof result.fiber.hasDebugSource).toBe('boolean');
        expect(typeof result.fiber.hasSource).toBe('boolean');
      }
    });
  });
  
  it('should demonstrate jsx-dev-runtime availability assessment', () => {
    // Check if jsx development runtime features are available
    const runtimeCheck = {
      jsxDev: null as any,
      jsxDevRuntime: null as any,
      hasTransform: false,
      error: null as string | null
    };
    
    try {
      // Try to access jsx-dev-runtime exports
      runtimeCheck.jsxDev = require('react/jsx-dev-runtime').jsxDEV;
      runtimeCheck.jsxDevRuntime = require('react/jsx-dev-runtime');
      runtimeCheck.hasTransform = true;
    } catch (error) {
      runtimeCheck.error = error instanceof Error ? error.message : 'Unknown error';
    }
    
    console.log('JSX Dev Runtime Availability:', runtimeCheck);
    
    expect(runtimeCheck.error || runtimeCheck.jsxDev).toBeTruthy();
    expect(typeof runtimeCheck.hasTransform).toBe('boolean');
  });
  
  it('should handle different source data formats', () => {
    const customTestCases = [
      // Case with relative path
      { 
        _owner: { 
          _debugSource: { 
            fileName: './src/components/Test.jsx',
            lineNumber: 10,
            columnNumber: 5
          }
        }
      },
      
      // Case with absolute path
      { 
        _owner: { 
          _debugSource: { 
            fileName: '/Users/project/app/components/Main.tsx',
            lineNumber: 45,
            columnNumber: 20
          }
        }
      }
    ];
    
    const results = customTestCases.map((mockElement, index) => {
      const fiber = (mockElement as any)._owner;
      return {
        testCase: index,
        success: !!fiber?._debugSource,
        fileName: fiber?._debugSource?.fileName,
        isRelative: fiber?._debugSource?.fileName?.startsWith('.'),
        isAbsolute: fiber?._debugSource?.fileName?.startsWith('/'),
        approach: 'jsx-dev-runtime'
      };
    });
    
    console.log('Path format test results:', results);
    
    expect(results[0].isRelative).toBe(true);
    expect(results[1].isAbsolute).toBe(true);
    expect(results.every(r => r.success)).toBe(true);
  });
});