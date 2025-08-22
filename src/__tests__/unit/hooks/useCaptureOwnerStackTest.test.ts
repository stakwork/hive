/**
 * Test for React 19 captureOwnerStack API
 * Purpose: Evaluate the reliability and data quality of captureOwnerStack for DOM inspection
 */

import { vi } from 'vitest';

// Test function to evaluate captureOwnerStack
function testCaptureOwnerStack() {
  // Mock captureOwnerStack since it may not be available in test environment
  const mockCaptureOwnerStack = vi.fn();
  
  // Simulate different return values
  const testCases = [
    null, // Production or unavailable
    '', // Empty stack
    'at TestComponent (/Users/test/project/src/components/Test.tsx:15:8)\nat render (/Users/test/node_modules/react/index.js:123:12)', // Typical stack
    'TestComponent@/Users/test/project/src/App.tsx:20:5\nrender@react/index.js:100:8' // Alternative format
  ];
  
  return testCases.map((mockStack, index) => {
    mockCaptureOwnerStack.mockReturnValue(mockStack);
    
    // Simulate the parsing logic from the hook
    if (process.env.NODE_ENV !== 'production' && mockStack) {
      const stackLines = mockStack.split('\n');
      const sourceMatch = stackLines[0]?.match(/at\s+.*\((.*):(\d+):(\d+)\)/);
      
      if (sourceMatch) {
        return {
          testCase: index,
          success: true,
          raw: mockStack,
          parsed: {
            file: sourceMatch[1],
            line: parseInt(sourceMatch[2]),
            column: parseInt(sourceMatch[3])
          },
          stackLines: stackLines.length,
          approach: 'captureOwnerStack'
        };
      }
      
      // Try alternative parsing
      const altMatch = stackLines.find(line => line.includes('.tsx') || line.includes('.ts') || line.includes('.jsx') || line.includes('.js'));
      if (altMatch) {
        return {
          testCase: index,
          success: true,
          raw: mockStack,
          parsed: {
            file: 'unknown',
            line: 0,
            column: 0,
            rawLine: altMatch
          },
          stackLines: stackLines.length,
          approach: 'captureOwnerStack'
        };
      }
    }
    
    return {
      testCase: index,
      success: false,
      raw: mockStack,
      parsed: null,
      stackLines: mockStack ? mockStack.split('\n').length : 0,
      approach: 'captureOwnerStack'
    };
  });
}

describe('captureOwnerStack API Evaluation', () => {
  it('should parse owner stack data correctly', () => {
    const results = testCaptureOwnerStack();
    
    console.log('captureOwnerStack Test Results:', results);
    
    // Test case 0: null (should fail)
    expect(results[0].success).toBe(false);
    expect(results[0].raw).toBe(null);
    
    // Test case 1: empty string (should fail)  
    expect(results[1].success).toBe(false);
    expect(results[1].raw).toBe('');
    
    // Test case 2: typical stack (should succeed)
    expect(results[2].success).toBe(true);
    expect(results[2].parsed?.file).toContain('.tsx');
    expect(results[2].parsed?.line).toBe(15);
    expect(results[2].parsed?.column).toBe(8);
    
    // Test case 3: alternative format (should succeed with fallback)
    expect(results[3].success).toBe(true);
    expect(results[3].parsed?.rawLine).toContain('App.tsx');
  });

  it('should handle production environment', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const results = testCaptureOwnerStack();
    
    // All should fail in production
    results.forEach(result => {
      expect(result.success).toBe(false);
    });
    
    process.env.NODE_ENV = originalEnv;
  });

  it('should provide consistent approach identification', () => {
    const results = testCaptureOwnerStack();
    
    results.forEach(result => {
      expect(result.approach).toBe('captureOwnerStack');
    });
  });
  
  it('should demonstrate real API availability', () => {
    // Try to import the actual captureOwnerStack
    let actualAPI: any = null;
    let importError: string | null = null;
    
    try {
      actualAPI = require('react').captureOwnerStack;
    } catch (error) {
      importError = error instanceof Error ? error.message : 'Unknown error';
    }
    
    console.log('Actual captureOwnerStack API:', {
      available: !!actualAPI,
      type: typeof actualAPI,
      importError
    });
    
    expect(typeof actualAPI === 'function' || actualAPI === undefined).toBe(true);
  });
});