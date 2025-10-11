import { vi } from 'vitest';

// Mock jsPDF functions
export const mockText = vi.fn();
export const mockAddPage = vi.fn();
export const mockSplitTextToSize = vi.fn();
export const mockSetFont = vi.fn();
export const mockSetFontSize = vi.fn();
export const mockSetTextColor = vi.fn();
export const mockSetLineWidth = vi.fn();
export const mockSetDrawColor = vi.fn();
export const mockLine = vi.fn();
export const mockSave = vi.fn();

export const mockPdfInstance = {
  text: mockText,
  addPage: mockAddPage,
  splitTextToSize: mockSplitTextToSize,
  setFont: mockSetFont,
  setFontSize: mockSetFontSize,
  setTextColor: mockSetTextColor,
  setLineWidth: mockSetLineWidth,
  setDrawColor: mockSetDrawColor,
  line: mockLine,
  save: mockSave,
  internal: {
    pageSize: {
      getWidth: vi.fn(() => 210), // A4 width in mm
      getHeight: vi.fn(() => 297), // A4 height in mm
    },
  },
};

// Mock jsPDF module
vi.mock('jspdf', () => ({
  default: vi.fn(() => mockPdfInstance),
}));

export function resetAllMocks() {
  vi.clearAllMocks();
  // Default mock implementation for splitTextToSize
  mockSplitTextToSize.mockImplementation((text: string) => [text]);
}
