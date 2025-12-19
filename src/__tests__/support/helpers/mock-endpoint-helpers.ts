/**
 * Helper utilities for testing mock API endpoints
 * 
 * Provides reusable functions for making requests to mock endpoints,
 * reducing duplication in integration tests.
 */

interface MockEndpointRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Make a request to a mock endpoint with default headers
 */
export async function makeMockEndpointRequest(
  endpoint: string,
  options: MockEndpointRequestOptions = {}
) {
  const {
    method = "POST",
    headers = {},
    body,
  } = options;

  const defaultHeaders = {
    "Content-Type": "application/json",
    "x-api-key": "test-key",
    "anthropic-version": "2023-06-01",
    ...headers,
  };

  const requestOptions: RequestInit = {
    method,
    headers: defaultHeaders,
  };

  if (body) {
    requestOptions.body = JSON.stringify(body);
  }

  return fetch(`${process.env.NEXTAUTH_URL}${endpoint}`, requestOptions);
}

/**
 * Create a basic Anthropic message request body
 */
export function createAnthropicMessageRequest(
  content: string,
  options: {
    model?: string;
    stream?: boolean;
    max_tokens?: number;
    conversationId?: string;
    messages?: Array<{ role: string; content: string }>;
  } = {}
) {
  const {
    model = "claude-3-5-sonnet-20241022",
    stream = false,
    max_tokens = 1024,
    conversationId,
    messages,
  } = options;

  const requestBody: Record<string, unknown> = {
    model,
    messages: messages || [
      {
        role: "user",
        content,
      },
    ],
    max_tokens,
    stream,
  };

  if (conversationId) {
    requestBody.metadata = {
      conversation_id: conversationId,
    };
  }

  return requestBody;
}

/**
 * Parse SSE (Server-Sent Events) response into events and data
 */
export function parseSSEResponse(text: string): {
  events: string[];
  dataLines: string[];
  parsedData: unknown[];
} {
  const lines = text.trim().split("\n");
  const events: string[] = [];
  const dataLines: string[] = [];
  const parsedData: unknown[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      events.push(line.substring(6).trim());
    } else if (line.startsWith("data:")) {
      const dataStr = line.substring(5).trim();
      dataLines.push(dataStr);
      try {
        parsedData.push(JSON.parse(dataStr));
      } catch {
        // Ignore parse errors for malformed data
      }
    }
  }

  return { events, dataLines, parsedData };
}

/**
 * Extract accumulated text from streaming content deltas
 */
export function extractStreamedText(parsedData: unknown[]): string {
  let accumulatedText = "";

  for (const data of parsedData) {
    if (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "content_block_delta"
    ) {
      const delta = (data as { delta?: { text?: string } }).delta;
      if (delta?.text) {
        accumulatedText += delta.text;
      }
    }
  }

  return accumulatedText;
}
