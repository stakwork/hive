/**
 * Mock Gemini State Manager
 * 
 * Manages in-memory state for Gemini image generation mocks.
 * Follows singleton pattern with auto-creation strategy for test resilience.
 */

interface GenerationRequest {
  id: string;
  prompt: string;
  model: string;
  createdAt: Date;
  imageBuffer: Buffer;
}

/**
 * Gemini Mock State Manager
 * Singleton class managing mock generation requests
 */
class GeminiMockState {
  private requests = new Map<string, GenerationRequest>();
  private requestCounter = 0;

  /**
   * Create a new generation request
   * Auto-generates ID and mock diagram image
   * 
   * @param prompt - Architecture description text
   * @param model - Gemini model name
   * @returns GenerationRequest with mock image data
   */
  createRequest(prompt: string, model: string): GenerationRequest {
    this.requestCounter++;
    const id = `mock-gen-${this.requestCounter}`;
    
    const request: GenerationRequest = {
      id,
      prompt,
      model,
      createdAt: new Date(),
      imageBuffer: this.generateMockDiagram(prompt),
    };
    
    this.requests.set(id, request);
    return request;
  }

  /**
   * Generate a mock diagram image
   * Returns a simple 1x1 transparent PNG
   * 
   * In a real implementation, could use canvas/sharp to generate actual diagram
   * For testing purposes, a minimal valid PNG is sufficient
   * 
   * @returns Buffer containing mock PNG image
   */
  private generateMockDiagram(): Buffer {
    // Simple 1x1 transparent PNG (smallest valid PNG)
    // Base64: iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
    const base64PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    return Buffer.from(base64PNG, 'base64');
  }

  /**
   * Get a request by ID
   * 
   * @param id - Request ID
   * @returns GenerationRequest or undefined if not found
   */
  getRequest(id: string): GenerationRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Get all requests (for testing/debugging)
   * 
   * @returns Array of all generation requests
   */
  getAllRequests(): GenerationRequest[] {
    return Array.from(this.requests.values());
  }

  /**
   * Reset all state (useful for tests)
   * Clears all requests and resets counter
   */
  reset(): void {
    this.requests.clear();
    this.requestCounter = 0;
  }
}

// Singleton instance
export const mockGeminiState = new GeminiMockState();
