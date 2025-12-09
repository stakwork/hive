/**
 * Mock Gemini State Manager
 * 
 * Manages in-memory state for mock Gemini API responses.
 * Auto-generates architecture diagram images on demand.
 */

export interface MockGeminiGenerationRequest {
  id: string;
  model: string;
  prompt: string;
  timestamp: Date;
}

export interface MockGeminiImage {
  id: string;
  base64Data: string;
  mimeType: string;
  prompt: string;
  createdAt: Date;
}

class GeminiMockState {
  private requests: Map<string, MockGeminiGenerationRequest> = new Map();
  private images: Map<string, MockGeminiImage> = new Map();
  private requestCounter = 0;
  
  /**
   * Generate a mock architecture diagram image
   * Returns a simple placeholder PNG as base64
   */
  generateArchitectureDiagram(prompt: string): MockGeminiImage {
    this.requestCounter++;
    const requestId = `mock-gemini-req-${this.requestCounter}`;
    
    // Store request
    this.requests.set(requestId, {
      id: requestId,
      model: 'gemini-2.5-flash-image',
      prompt,
      timestamp: new Date(),
    });
    
    // Generate a mock PNG image (1x1 transparent pixel as placeholder)
    // In a real mock, you could generate different images based on prompt content
    const mockImageBase64 = this.createMockArchitectureDiagram(prompt);
    
    const image: MockGeminiImage = {
      id: requestId,
      base64Data: mockImageBase64,
      mimeType: 'image/png',
      prompt,
      createdAt: new Date(),
    };
    
    this.images.set(requestId, image);
    
    return image;
  }
  
  /**
   * Create a mock architecture diagram based on prompt
   * For simplicity, returns a valid 1x1 PNG as base64
   * 
   * Future enhancement: Use node-canvas or similar to generate
   * actual diagrams with boxes and arrows based on prompt
   */
  private createMockArchitectureDiagram(prompt: string): string {
    // Valid 1x1 transparent PNG in base64
    // This is a minimal valid PNG file
    const transparentPixel = 
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    // For more sophisticated mock: analyze prompt and return different patterns
    // e.g., different colored pixels based on components mentioned
    return transparentPixel;
  }
  
  getRequestById(id: string): MockGeminiGenerationRequest | undefined {
    return this.requests.get(id);
  }
  
  getImageById(id: string): MockGeminiImage | undefined {
    return this.images.get(id);
  }
  
  getAllRequests(): MockGeminiGenerationRequest[] {
    return Array.from(this.requests.values());
  }
  
  /**
   * Reset state for test isolation
   */
  reset(): void {
    this.requests.clear();
    this.images.clear();
    this.requestCounter = 0;
  }
}

// Singleton instance
export const geminiMockState = new GeminiMockState();