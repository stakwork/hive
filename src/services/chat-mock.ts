/**
 * Mock Chat Service
 * 
 * Provides mock chat processing functionality for development and testing.
 * Used by both /api/chat/message and /api/mock/chat endpoints to avoid
 * internal HTTP calls and improve performance.
 */

export interface MockChatRequest {
  taskId: string;
  message: string;
  userId: string;
  artifacts: ArtifactRequest[];
  history: Record<string, unknown>[];
}

export interface ArtifactRequest {
  id?: string;
  type: string;
  title: string;
  content: string;
  language?: string;
}

export interface MockChatResponse {
  success: boolean;
  data?: {
    id: string;
    role: "assistant";
    content: string;
    createdAt: string;
    artifacts?: Array<{
      id: string;
      type: string;
      title: string;
      content: string;
      language?: string;
    }>;
  };
  error?: string;
}

/**
 * Process mock chat request
 * 
 * Generates a mock response for chat messages during development/testing.
 * This service function is used by both authenticated and mock endpoints.
 * 
 * @param request - Mock chat request parameters
 * @returns Promise resolving to mock chat response
 */
export async function processMockChat(
  request: MockChatRequest,
): Promise<MockChatResponse> {
  try {
    const { taskId, message, userId, artifacts } = request;

    // Validate required fields
    if (!taskId || !message || !userId) {
      return {
        success: false,
        error: "Missing required fields: taskId, message, or userId",
      };
    }

    // Generate mock response based on message content
    const mockResponse = generateMockResponse(message, artifacts);

    // Create response object matching ChatMessage structure
    const responseData = {
      id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "assistant" as const,
      content: mockResponse.content,
      createdAt: new Date().toISOString(),
      artifacts: mockResponse.artifacts,
    };

    return {
      success: true,
      data: responseData,
    };
  } catch (error) {
    console.error("[MockChatService] Error processing mock chat:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Generate mock response content based on user message
 */
function generateMockResponse(
  message: string,
  artifacts: ArtifactRequest[],
): {
  content: string;
  artifacts?: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
    language?: string;
  }>;
} {
  const lowerMessage = message.toLowerCase();

  // Generate context-aware mock responses
  if (lowerMessage.includes("test") || lowerMessage.includes("spec")) {
    return {
      content:
        "I can help you with that test. Here's a mock test implementation that follows best practices for testing in this codebase.",
      artifacts: [
        {
          id: `artifact-${Date.now()}`,
          type: "code",
          title: "test-example.spec.ts",
          content: `import { describe, it, expect } from 'vitest';\n\ndescribe('Example Test', () => {\n  it('should pass', () => {\n    expect(true).toBe(true);\n  });\n});`,
          language: "typescript",
        },
      ],
    };
  }

  if (lowerMessage.includes("component") || lowerMessage.includes("react")) {
    return {
      content:
        "I've created a basic React component structure for you. This follows the project conventions with TypeScript and proper typing.",
      artifacts: [
        {
          id: `artifact-${Date.now()}`,
          type: "code",
          title: "ExampleComponent.tsx",
          content: `import React from 'react';\n\ninterface ExampleComponentProps {\n  title: string;\n}\n\nexport const ExampleComponent: React.FC<ExampleComponentProps> = ({ title }) => {\n  return (\n    <div className="p-4">\n      <h2 className="text-xl font-bold">{title}</h2>\n    </div>\n  );\n};`,
          language: "typescript",
        },
      ],
    };
  }

  if (lowerMessage.includes("api") || lowerMessage.includes("endpoint")) {
    return {
      content:
        "Here's a basic API route structure following Next.js 15 App Router conventions with proper error handling.",
      artifacts: [
        {
          id: `artifact-${Date.now()}`,
          type: "code",
          title: "route.ts",
          content: `import { NextRequest, NextResponse } from 'next/server';\nimport { getServerSession } from 'next-auth';\nimport { authOptions } from '@/lib/auth/nextauth';\n\nexport async function GET(request: NextRequest) {\n  const session = await getServerSession(authOptions);\n  \n  if (!session?.user) {\n    return NextResponse.json(\n      { error: 'Authentication required' },\n      { status: 401 }\n    );\n  }\n\n  return NextResponse.json({ message: 'Success' });\n}`,
          language: "typescript",
        },
      ],
    };
  }

  // Default response
  return {
    content: `This is a mock response to your message: "${message}". In a real implementation, this would be processed by an AI agent with access to your codebase context.`,
    artifacts:
      artifacts.length > 0
        ? artifacts.map((artifact, index) => ({
            id: `artifact-${Date.now()}-${index}`,
            type: artifact.type,
            title: artifact.title,
            content: artifact.content,
            language: artifact.language,
          }))
        : undefined,
  };
}
