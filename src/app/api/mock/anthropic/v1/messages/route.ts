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
      max_tokens = 4096,
      temperature = 0.7,
      stream = false,
      tools = [],
    } = body;

    console.log("[Mock Anthropic] Received request:", {
      model,
      messageCount: messages.length,
      stream,
      hasTools: tools.length > 0,
    });

    // Extract prompt from messages
    const userMessage = messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const prompt = userMessage?.content || "";

    // Generate mock response
    const responseContent = mockAnthropicState.generateResponse(
      typeof prompt === "string" ? prompt : JSON.stringify(prompt),
      system
    );

    const responseText =
      typeof responseContent === "string"
        ? responseContent
        : JSON.stringify(responseContent);

    // Non-streaming response
    if (!stream) {
      const response = {
        id: mockAnthropicState.generateRequestId(),
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
        model,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: Math.floor(prompt.length / 4), // Rough estimate
          output_tokens: Math.floor(responseText.length / 4),
        },
      };

      return NextResponse.json(response);
    }

    // Streaming response
    const encoder = new TextEncoder();
    const streamResponse = new ReadableStream({
      async start(controller) {
        try {
          // Send message_start event
          controller.enqueue(
            encoder.encode(
              `event: message_start\ndata: ${JSON.stringify({
                type: "message_start",
                message: {
                  id: mockAnthropicState.generateRequestId(),
                  type: "message",
                  role: "assistant",
                  model,
                },
              })}\n\n`
            )
          );

          // Send content_block_start event
          controller.enqueue(
            encoder.encode(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              })}\n\n`
            )
          );

          // Stream content chunks
          for (const chunk of mockAnthropicState.generateStreamChunks(
            responseText,
            10
          )) {
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

          // Send content_block_stop event
          controller.enqueue(
            encoder.encode(
              `event: content_block_stop\ndata: ${JSON.stringify({
                type: "content_block_stop",
                index: 0,
              })}\n\n`
            )
          );

          // Send message_delta event (final usage)
          controller.enqueue(
            encoder.encode(
              `event: message_delta\ndata: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: Math.floor(responseText.length / 4) },
              })}\n\n`
            )
          );

          // Send message_stop event
          controller.enqueue(
            encoder.encode(
              `event: message_stop\ndata: ${JSON.stringify({
                type: "message_stop",
              })}\n\n`
            )
          );

          controller.close();
        } catch (error) {
          console.error("[Mock Anthropic] Stream error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(streamResponse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
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
