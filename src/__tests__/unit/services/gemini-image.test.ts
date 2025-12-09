import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateArchitectureDiagram,
  buildArchitectureDiagramPrompt,
  GeminiError,
  GeminiErrorType,
} from '@/services/gemini-image';
import { geminiMockState } from '@/lib/mock/gemini-state';

// Mock the env config
vi.mock('@/config/env', () => ({
  config: {
    USE_MOCKS: false, // Set to false so tests use mocked SDK directly
    MOCK_BASE: 'http://localhost:3000',
  },
  getGeminiApiKey: vi.fn(() => 'test-api-key'),
}));

// Mock the wrapper to return a controllable mock SDK
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@/lib/mock/gemini-wrapper', () => ({
  getGoogleGenerativeAI: vi.fn(async () => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

describe('gemini-image service', () => {
  describe('buildArchitectureDiagramPrompt', () => {
    it('should construct a proper prompt with architecture text', () => {
      const architectureText = 'Frontend connects to API Gateway, which routes to microservices';
      const prompt = buildArchitectureDiagramPrompt(architectureText);
      
      expect(prompt).toContain('Convert the following architecture description');
      expect(prompt).toContain('professional system architecture diagram');
      expect(prompt).toContain('components, connections, and labels');
      expect(prompt).toContain('technical diagram style');
      expect(prompt).toContain(architectureText);
    });
    
    it('should include requirements in the prompt', () => {
      const prompt = buildArchitectureDiagramPrompt('Test architecture');
      
      expect(prompt).toContain('major components as labeled boxes');
      expect(prompt).toContain('arrows to indicate data flow');
      expect(prompt).toContain('labels on arrows');
      expect(prompt).toContain('clean, technical style');
      expect(prompt).toContain('readable and properly sized');
    });
  });
  
  describe('generateArchitectureDiagram', () => {
    beforeEach(() => {
      // Reset mocks before each test
      vi.clearAllMocks();
      mockGenerateContent.mockReset();
      mockGetGenerativeModel.mockReset();
      
      // Re-setup default mock behavior
      mockGetGenerativeModel.mockReturnValue({
        generateContent: mockGenerateContent,
      });
    });
    
    it('should successfully generate an architecture diagram', async () => {
      // Mock successful API response with image data
      const mockImageData = Buffer.from('fake-png-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: mockImageData,
                    },
                  },
                ],
              },
            },
          ],
        },
      });
      
      const result = await generateArchitectureDiagram('Frontend -> Backend -> Database');
      
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash-image',
      });
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.stringContaining('Convert the following architecture description')
      );
    });
    
    it('should throw error when architecture text is empty', async () => {
      await expect(generateArchitectureDiagram('')).rejects.toThrow(GeminiError);
      await expect(generateArchitectureDiagram('   ')).rejects.toThrow(
        'Architecture text cannot be empty'
      );
    });
    
    it('should handle authentication errors', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('API key is invalid or unauthorized')
      );
      
      await expect(
        generateArchitectureDiagram('Test architecture')
      ).rejects.toThrow(GeminiError);
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.AUTHENTICATION);
      }
    });
    
    it('should handle rate limit errors', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('Rate limit exceeded. Please try again later.')
      );
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.RATE_LIMIT);
        expect((error as GeminiError).message).toContain('Rate limit');
      }
    });
    
    it('should handle network errors', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('Network request failed: ECONNREFUSED')
      );
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.NETWORK);
      }
    });
    
    it('should handle invalid response with no candidates', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [],
        },
      });
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.INVALID_RESPONSE);
        expect((error as GeminiError).message).toContain('No image candidates');
      }
    });
    
    it('should handle invalid response structure', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [],
              },
            },
          ],
        },
      });
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.INVALID_RESPONSE);
      }
    });
    
    it('should handle missing image data in response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Some text response instead of image',
                  },
                ],
              },
            },
          ],
        },
      });
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.INVALID_RESPONSE);
        expect((error as GeminiError).message).toContain('No image data found');
      }
    });
    
    it('should handle empty buffer response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: '',
                    },
                  },
                ],
              },
            },
          ],
        },
      });
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).type).toBe(GeminiErrorType.INVALID_RESPONSE);
        expect((error as GeminiError).message).toContain('No image data found');
      }
    });
    
    it('should preserve original error in GeminiError', async () => {
      const originalError = new Error('Original error message');
      mockGenerateContent.mockRejectedValue(originalError);
      
      try {
        await generateArchitectureDiagram('Test architecture');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiError);
        expect((error as GeminiError).originalError).toBe(originalError);
      }
    });
    
    it('should return valid PNG buffer', async () => {
      const mockImageData = Buffer.from('fake-png-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: mockImageData,
                    },
                  },
                ],
              },
            },
          ],
        },
      });
      
      const result = await generateArchitectureDiagram('Test architecture');
      
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('fake-png-data');
    });
    
    it('should use correct model name', async () => {
      const mockImageData = Buffer.from('fake-png-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: mockImageData,
                    },
                  },
                ],
              },
            },
          ],
        },
      });
      
      await generateArchitectureDiagram('Test architecture');
      
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash-image',
      });
    });
  });
  
  describe('GeminiError', () => {
    it('should create error with correct properties', () => {
      const originalError = new Error('Original');
      const error = new GeminiError(
        'Test error',
        GeminiErrorType.RATE_LIMIT,
        originalError
      );
      
      expect(error.name).toBe('GeminiError');
      expect(error.message).toBe('Test error');
      expect(error.type).toBe(GeminiErrorType.RATE_LIMIT);
      expect(error.originalError).toBe(originalError);
    });
  });
});
