import { expect } from 'vitest';
import { mockText, mockSplitTextToSize, mockSetFont, mockSetFontSize } from './__mocks';

/**
 * Helper to find mock calls containing specific text
 */
export function findMockCallsWithText(mockFn: any, searchText: string) {
  return mockFn.mock.calls.filter(
    (call: any[]) => typeof call[0] === 'string' && call[0].includes(searchText)
  );
}

/**
 * Helper to verify role label was called for a specific role
 */
export function expectRoleLabelCalled(role: 'user' | 'assistant') {
  const expectedLabel = role === 'user' ? 'You:' : 'Learning Assistant:';
  expect(mockText).toHaveBeenCalledWith(expectedLabel, expect.any(Number), expect.any(Number));
}

/**
 * Helper to verify content was processed by splitTextToSize
 */
export function expectContentProcessed(expectedContent: string) {
  const contentCall = mockSplitTextToSize.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes(expectedContent)
  );
  expect(contentCall).toBeDefined();
  return contentCall;
}

/**
 * Helper to count font changes of specific type
 */
export function countFontChanges(fontFamily: string, fontWeight: string) {
  return mockSetFont.mock.calls.filter(
    (call) => call[0] === fontFamily && call[1] === fontWeight
  ).length;
}

/**
 * Helper to count font size changes
 */
export function countFontSizeChanges(fontSize: number) {
  return mockSetFontSize.mock.calls.filter(
    (call) => call[0] === fontSize
  ).length;
}

/**
 * Helper to verify y-coordinate progression in text calls
 */
export function verifyYCoordinateProgression(searchTexts: string[]) {
  const textCalls = searchTexts.map(text => 
    mockText.mock.calls.find(call => call[0] === text)
  ).filter(Boolean);

  if (textCalls.length > 1) {
    for (let i = 1; i < textCalls.length; i++) {
      const prevY = textCalls[i - 1][2];
      const currentY = textCalls[i][2];
      expect(currentY).toBeGreaterThan(prevY);
    }
  }
  
  return textCalls;
}

/**
 * Helper to verify consistent x-coordinate for content
 */
export function verifyConsistentXCoordinate(searchTexts: string[]) {
  const textCalls = searchTexts.map(text =>
    mockText.mock.calls.find(call => call[0] === text)
  ).filter(Boolean);

  if (textCalls.length > 1) {
    const firstX = textCalls[0][1];
    textCalls.forEach(call => {
      expect(call[1]).toBe(firstX);
    });
  }

  return textCalls;
}
