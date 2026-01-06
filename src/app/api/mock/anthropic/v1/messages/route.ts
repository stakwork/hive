import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";

/**
 * Mock Anthropic Messages API Endpoint
 *
 * Simulates: POST https://api.anthropic.com/v1/messages
 *
 * Handles both streaming and non-streaming responses.
 * Used by all Vercel AI SDK calls (streamText, generateObject, etc.)
 */

// Mock data for different generation types
const MOCK_GENERATION_DATA: Record<string, unknown> = {
  userStories: {
    stories: [
      { title: "As a user, I want to log in with my email so that I can access my account securely" },
      { title: "As a user, I want to reset my password via email so that I can regain access if I forget it" },
      { title: "As a user, I want to view my dashboard after login so that I can see my recent activity" },
    ],
  },
  requirements: {
    content: `## Functional Requirements

1. **User Authentication**
   - Users must be able to register with email and password
   - Users must be able to log in with valid credentials
   - Session management with secure token handling

2. **Data Management**
   - CRUD operations for primary entities
   - Data validation on all inputs
   - Proper error handling and user feedback

3. **Security**
   - Password hashing with bcrypt
   - Rate limiting on authentication endpoints
   - Input sanitization to prevent XSS/SQL injection

## Non-Functional Requirements

- Response time < 200ms for API calls
- 99.9% uptime SLA
- Support for 1000 concurrent users`,
  },
  architecture: {
    content: `## System Architecture

### Frontend
- **Framework**: Next.js 15 with App Router
- **State Management**: Zustand for client state, React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui components

### Backend
- **API**: Next.js API routes with middleware authentication
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js with JWT sessions

### Infrastructure
- **Hosting**: Vercel for frontend and serverless functions
- **Database**: Managed PostgreSQL (e.g., Supabase, Neon)
- **CDN**: Vercel Edge Network

### Data Flow
1. Client makes request to API route
2. Middleware validates authentication
3. Route handler processes request
4. Prisma queries database
5. Response returned to client`,
  },
  phasesTickets: {
    phases: [
      {
        name: "Foundation",
        description: "Set up project infrastructure and core systems",
        tasks: [
          { title: "Initialize project with Next.js 15", description: "Set up the base Next.js project with TypeScript and Tailwind", priority: "HIGH", tempId: "T1", dependsOn: [] },
          { title: "Configure database schema", description: "Design and implement Prisma schema for core entities", priority: "HIGH", tempId: "T2", dependsOn: ["T1"] },
          { title: "Set up authentication", description: "Implement NextAuth.js with GitHub OAuth", priority: "HIGH", tempId: "T3", dependsOn: ["T2"] },
        ],
      },
      {
        name: "Core Features",
        description: "Implement main application functionality",
        tasks: [
          { title: "Build dashboard UI", description: "Create main dashboard with summary widgets", priority: "MEDIUM", tempId: "T4", dependsOn: ["T3"] },
          { title: "Implement CRUD operations", description: "Add create, read, update, delete for main entities", priority: "HIGH", tempId: "T5", dependsOn: ["T4"] },
          { title: "Add search and filtering", description: "Implement search functionality with filters", priority: "MEDIUM", tempId: "T6", dependsOn: ["T5"] },
        ],
      },
    ],
  },
  tickets: {
    phases: [
      {
        name: "Implementation",
        description: "Development tasks",
        tasks: [
          { title: "Implement feature component", description: "Build the main feature UI component", priority: "HIGH", tempId: "T1", dependsOn: [] },
          { title: "Add API endpoint", description: "Create backend API for the feature", priority: "HIGH", tempId: "T2", dependsOn: [] },
          { title: "Write tests", description: "Add unit and integration tests", priority: "MEDIUM", tempId: "T3", dependsOn: ["T1", "T2"] },
        ],
      },
    ],
  },
};

function detectGenerationType(prompt: string, system: string, tools: unknown[]): string | null {
  const combinedText = `${prompt} ${system}`.toLowerCase();

  // Check for tool names first (AI SDK sends schema as a tool)
  if (tools && tools.length > 0) {
    const toolStr = JSON.stringify(tools).toLowerCase();
    if (toolStr.includes("stories")) return "userStories";
    if (toolStr.includes("phases") || toolStr.includes("tasks")) return "phasesTickets";
  }

  // Fall back to prompt analysis
  if (combinedText.includes("user stor") || combinedText.includes("user journey")) return "userStories";
  if (combinedText.includes("requirement")) return "requirements";
  if (combinedText.includes("architecture") || combinedText.includes("technical design")) return "architecture";
  if (combinedText.includes("phase") || combinedText.includes("ticket") || combinedText.includes("task")) return "phasesTickets";

  return null;
}

export async function POST(request: NextRequest) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: { type: "not_found_error", message: "Not found" } },
      { status: 404 }
    );
  }

  try {
    // Verify API key header
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey || !apiKey.startsWith("mock-anthropic-key")) {
      return NextResponse.json(
        {
          error: {
            type: "authentication_error",
            message: "Invalid API key",
          },
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      model = "claude-3-5-sonnet-20241022",
      messages = [],
      system = "",
      stream = false,
      tools = [],
    } = body;

    // Extract prompt from messages
    const userMessage = messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const prompt = userMessage?.content || "";
    const promptStr = typeof prompt === "string" ? prompt : JSON.stringify(prompt);

    // Check if this is a continuation of a tool conversation
    const hasToolResults = messages.some(
      (m: { role: string; content?: { type?: string }[] }) =>
        m.role === "tool" || (Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result"))
    );

    console.log("[Mock Anthropic] Received request:", {
      model,
      messageCount: messages.length,
      stream,
      hasTools: tools.length > 0,
      hasToolResults,
    });

    // Check if this is a structured generation request (streamObject)
    // Don't treat it as structured generation if there are tool results (ongoing conversation)
    const generationType = hasToolResults ? null : detectGenerationType(promptStr, system, tools);

    if (generationType && tools.length > 0) {
      console.log("[Mock Anthropic] Detected generation type:", generationType);
      const mockData = MOCK_GENERATION_DATA[generationType];
      const toolName = tools[0]?.name || "json";

      // For streamObject, AI SDK expects a tool_use response
      if (stream) {
        return streamToolUseResponse(model, toolName, mockData);
      } else {
        return NextResponse.json({
          id: mockAnthropicState.generateRequestId(),
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `tool_${Date.now()}`,
              name: toolName,
              input: mockData,
            },
          ],
          model,
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 200 },
        });
      }
    }

    // Regular text response
    const responseContent = mockAnthropicState.generateResponse(promptStr, system);
    const responseText =
      typeof responseContent === "string"
        ? responseContent
        : JSON.stringify(responseContent);

    // Non-streaming response
    if (!stream) {
      return NextResponse.json({
        id: mockAnthropicState.generateRequestId(),
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: responseText }],
        model,
        stop_reason: "end_turn",
        usage: {
          input_tokens: Math.floor(promptStr.length / 4),
          output_tokens: Math.floor(responseText.length / 4),
        },
      });
    }

    // Streaming text response
    return streamTextResponse(model, responseText);
  } catch (error) {
    console.error("[Mock Anthropic] Error:", error);
    return NextResponse.json(
      {
        error: {
          type: "internal_server_error",
          message: "Internal server error",
        },
      },
      { status: 500 }
    );
  }
}

function streamTextResponse(model: string, text: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // message_start
      controller.enqueue(
        encoder.encode(
          `event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: {
              id: mockAnthropicState.generateRequestId(),
              type: "message",
              role: "assistant",
              model,
              usage: { input_tokens: 0, output_tokens: 0 }
            },
          })}\n\n`
        )
      );

      // content_block_start
      controller.enqueue(
        encoder.encode(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`
        )
      );

      // Stream text chunks
      for (const chunk of mockAnthropicState.generateStreamChunks(text)) {
        controller.enqueue(
          encoder.encode(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: chunk },
            })}\n\n`
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // content_block_stop
      controller.enqueue(
        encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`)
      );

      // message_delta
      controller.enqueue(
        encoder.encode(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: Math.floor(text.length / 4) },
          })}\n\n`
        )
      );

      // message_stop
      controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

function streamToolUseResponse(model: string, toolName: string, data: unknown) {
  const encoder = new TextEncoder();
  const jsonStr = JSON.stringify(data);
  const toolId = `toolu_mock_${Date.now()}`;

  const stream = new ReadableStream({
    async start(controller) {
      // message_start
      controller.enqueue(
        encoder.encode(
          `event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: {
              id: mockAnthropicState.generateRequestId(),
              type: "message",
              role: "assistant",
              model,
              usage: { input_tokens: 0, output_tokens: 0 }
            },
          })}\n\n`
        )
      );

      // content_block_start for tool_use
      controller.enqueue(
        encoder.encode(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: toolId, name: toolName },
          })}\n\n`
        )
      );

      // Stream the JSON input in chunks
      const chunkSize = 50;
      for (let i = 0; i < jsonStr.length; i += chunkSize) {
        const chunk = jsonStr.slice(i, i + chunkSize);
        controller.enqueue(
          encoder.encode(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: chunk },
            })}\n\n`
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // content_block_stop
      controller.enqueue(
        encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`)
      );

      // message_delta
      controller.enqueue(
        encoder.encode(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: Math.floor(jsonStr.length / 4) },
          })}\n\n`
        )
      );

      // message_stop
      controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
