/**
 * Mock Anthropic State Manager
 *
 * Manages in-memory state for mock Anthropic API responses.
 * Handles conversation history, streaming responses, and model configurations.
 *
 * Features:
 * - Simulates streaming text/object generation
 * - Maintains conversation context
 * - Auto-generates realistic responses based on prompts
 * - Supports different model configurations (haiku, sonnet, opus)
 * - Resetable for test isolation
 */

interface MockConversation {
  id: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  createdAt: Date;
}

interface MockModelConfig {
  id: string;
  name: string;
  maxTokens: number;
  temperature: number;
}

export class MockAnthropicStateManager {
  private static instance: MockAnthropicStateManager;
  private conversations: Map<string, MockConversation> = new Map();
  private requestCounter = 1;

  private models: Record<string, MockModelConfig> = {
    haiku: {
      id: "claude-3-haiku-20240307",
      name: "Claude 3 Haiku",
      maxTokens: 4096,
      temperature: 0.7,
    },
    sonnet: {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      maxTokens: 8192,
      temperature: 0.7,
    },
    opus: {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      maxTokens: 4096,
      temperature: 0.7,
    },
  };

  private constructor() {}

  static getInstance(): MockAnthropicStateManager {
    if (!MockAnthropicStateManager.instance) {
      MockAnthropicStateManager.instance = new MockAnthropicStateManager();
    }
    return MockAnthropicStateManager.instance;
  }

  /**
   * Generate a mock response based on the prompt
   * Uses simple pattern matching to return realistic responses
   */
  generateResponse(
    prompt: string,
    systemPrompt?: string,
    schema?: Record<string, unknown>
  ): string | Record<string, unknown> {
    const lowerPrompt = prompt.toLowerCase();

    // Feature extraction responses
    if (lowerPrompt.includes("feature") && lowerPrompt.includes("transcript")) {
      return {
        title: "Mock Generated Feature",
        brief:
          "This is a mock feature generated from the transcript analysis. It demonstrates the expected behavior without calling the real Anthropic API.",
        requirements:
          "1. Mock requirement one\n2. Mock requirement two\n3. Mock requirement three",
      };
    }

    // User story generation
    if (
      lowerPrompt.includes("user stor") ||
      lowerPrompt.includes("acceptance criteria")
    ) {
      return {
        userStories: [
          {
            title: "As a user, I want to see mock data",
            description: "This is a mock user story for testing purposes",
            acceptanceCriteria: ["Mock criterion 1", "Mock criterion 2"],
          },
        ],
      };
    }

    // Phase generation
    if (lowerPrompt.includes("phase") || lowerPrompt.includes("milestone")) {
      return {
        phases: [
          {
            title: "Phase 1: Foundation",
            description: "Set up the basic infrastructure",
            estimatedDuration: "2 weeks",
          },
          {
            title: "Phase 2: Implementation",
            description: "Build core features",
            estimatedDuration: "4 weeks",
          },
        ],
      };
    }

    // Wake word detection
    if (lowerPrompt.includes("wake word") || lowerPrompt.includes("hive")) {
      return {
        detected: true,
        confidence: 0.95,
        command: "create feature",
      };
    }

    // Commit message generation
    if (lowerPrompt.includes("commit") || lowerPrompt.includes("diff")) {
      return {
        message: "feat: mock commit message",
        description: "This is a mock commit message generated for testing",
      };
    }

    // Code assistance / Ask queries
    if (systemPrompt?.includes("code") || lowerPrompt.includes("how")) {
      return "Here's a mock response to your code question. In a real scenario, this would analyze your codebase and provide specific guidance based on the repository context.";
    }

    // Default generic response
    return schema
      ? { result: "Mock structured response", success: true }
      : "Mock response: I understand your request and would provide a detailed answer if this were connected to the real Anthropic API.";
  }

  /**
   * Simulate streaming response chunks
   */
  *generateStreamChunks(response: string, delayMs = 10): Generator<string> {
    const words = response.split(" ");
    for (const word of words) {
      yield word + " ";
    }
  }

  /**
   * Create a new conversation
   */
  createConversation(id: string): MockConversation {
    const conversation: MockConversation = {
      id,
      messages: [],
      createdAt: new Date(),
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  /**
   * Add message to conversation
   */
  addMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.messages.push({ role, content });
    }
  }

  /**
   * Get model configuration
   */
  getModelConfig(modelType: string = "sonnet"): MockModelConfig {
    return this.models[modelType] || this.models.sonnet;
  }

  /**
   * Generate unique request ID
   */
  generateRequestId(): string {
    return `mock-req-${this.requestCounter++}`;
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.conversations.clear();
    this.requestCounter = 1;
  }
}

// Export singleton instance
export const mockAnthropicState = MockAnthropicStateManager.getInstance();
