interface MockDiagramRequest {
  id: string;
  prompt: string;
  model: string;
  timestamp: Date;
}

class MockGeminiStateManager {
  private static instance: MockGeminiStateManager;
  private diagrams: Map<string, MockDiagramRequest> = new Map();
  private requestCounter = 1;

  private constructor() {}

  static getInstance(): MockGeminiStateManager {
    if (!MockGeminiStateManager.instance) {
      MockGeminiStateManager.instance = new MockGeminiStateManager();
    }
    return MockGeminiStateManager.instance;
  }

  /**
   * Generates a mock architecture diagram (deterministic simple diagram)
   */
  generateDiagram(prompt: string, model: string): string {
    const requestId = `mock-gemini-req-${this.requestCounter++}`;

    this.diagrams.set(requestId, {
      id: requestId,
      prompt,
      model,
      timestamp: new Date(),
    });

    // Return a minimal valid PNG as base64
    return this.getMinimalPngBase64();
  }

  /**
   * Returns a minimal valid PNG image as base64
   * This is a 1x1 white pixel PNG (85 bytes)
   */
  private getMinimalPngBase64(): string {
    // 1x1 white pixel PNG
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    return pngBuffer.toString("base64");
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.diagrams.clear();
    this.requestCounter = 1;
  }

  /**
   * Get diagram generation history
   */
  getDiagramHistory(): MockDiagramRequest[] {
    return Array.from(this.diagrams.values());
  }
}

export const mockGeminiState = MockGeminiStateManager.getInstance();
